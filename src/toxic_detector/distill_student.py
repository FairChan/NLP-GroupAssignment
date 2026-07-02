from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from src.toxic_detector.config import LABELS
from src.toxic_detector.data import load_jigsaw_train, multilabel_train_valid_split
from src.toxic_detector.metrics import compute_multilabel_metrics, find_best_thresholds, save_json
from src.toxic_detector.retraining import distillation_loss, evaluate_release_gate, load_json_config
from src.toxic_detector.supplemental_data import append_optional_supplemental_data
from src.toxic_detector.tokenization import encode_head_tail


class RawToxicDataset(Dataset):
    def __init__(self, texts, labels):
        self.texts = list(texts)
        self.labels = np.asarray(labels, dtype=np.float32)

    def __len__(self) -> int:
        return len(self.texts)

    def __getitem__(self, index: int) -> dict:
        return {
            "text": self.texts[index],
            "labels": self.labels[index],
        }


def encode_batch(tokenizer, texts, max_length: int, head_tokens: int, tail_tokens: int, device) -> dict[str, torch.Tensor]:
    rows = [
        encode_head_tail(
            tokenizer,
            text,
            max_length=max_length,
            head_tokens=head_tokens,
            tail_tokens=tail_tokens,
        )
        for text in texts
    ]
    return {
        "input_ids": torch.tensor([row["input_ids"] for row in rows], dtype=torch.long, device=device),
        "attention_mask": torch.tensor([row["attention_mask"] for row in rows], dtype=torch.long, device=device),
    }


def collate_raw(batch) -> dict:
    return {
        "texts": [item["text"] for item in batch],
        "labels": torch.tensor(np.stack([item["labels"] for item in batch]), dtype=torch.float32),
    }


@torch.no_grad()
def predict_student_probabilities(model, tokenizer, dataloader, config: dict, device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    all_logits = []
    all_labels = []
    for batch in tqdm(dataloader, desc="eval", leave=False):
        encoded = encode_batch(
            tokenizer,
            batch["texts"],
            int(config.get("max_length", 256)),
            int(config.get("head_tokens", 200)),
            int(config.get("tail_tokens", 50)),
            device,
        )
        logits = model(**encoded).logits
        all_logits.append(logits.detach().cpu())
        all_labels.append(batch["labels"])
    logits = torch.cat(all_logits).numpy()
    labels = torch.cat(all_labels).numpy()
    probabilities = 1.0 / (1.0 + np.exp(-logits))
    return labels, probabilities


def train_student(config: dict) -> dict:
    output_dir = Path(config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    frame = load_jigsaw_train(config.get("data_path", "data/raw/train.csv"))
    frame = append_optional_supplemental_data(frame, config.get("supplemental_data"))
    train_frame, valid_frame = multilabel_train_valid_split(
        frame,
        valid_size=float(config.get("valid_size", 0.1)),
        random_state=int(config.get("seed", 42)),
    )

    device = torch.device("cuda" if torch.cuda.is_available() and not config.get("cpu", False) else "cpu")
    fp16 = bool(config.get("fp16", True)) and device.type == "cuda"
    seed = int(config.get("seed", 42))
    torch.manual_seed(seed)
    np.random.seed(seed)

    teacher_dir = config["teacher_dir"]
    trust_remote_code = bool(config.get("trust_remote_code", False))
    teacher_tokenizer = AutoTokenizer.from_pretrained(teacher_dir, trust_remote_code=trust_remote_code)
    student_tokenizer = AutoTokenizer.from_pretrained(config["model_name"], trust_remote_code=trust_remote_code)
    teacher_model = AutoModelForSequenceClassification.from_pretrained(
        teacher_dir,
        num_labels=len(LABELS),
        problem_type="multi_label_classification",
        trust_remote_code=trust_remote_code,
    ).to(device)
    student_model = AutoModelForSequenceClassification.from_pretrained(
        config["model_name"],
        num_labels=len(LABELS),
        problem_type="multi_label_classification",
        trust_remote_code=trust_remote_code,
    ).to(device)
    teacher_model.eval()

    train_loader = DataLoader(
        RawToxicDataset(train_frame["comment_text"], train_frame[LABELS].to_numpy()),
        batch_size=int(config.get("batch_size", 8)),
        shuffle=True,
        num_workers=int(config.get("num_workers", 0)),
        collate_fn=collate_raw,
    )
    valid_loader = DataLoader(
        RawToxicDataset(valid_frame["comment_text"], valid_frame[LABELS].to_numpy()),
        batch_size=int(config.get("eval_batch_size", 16)),
        shuffle=False,
        num_workers=int(config.get("num_workers", 0)),
        collate_fn=collate_raw,
    )

    optimizer = torch.optim.AdamW(
        student_model.parameters(),
        lr=float(config.get("lr", 3e-5)),
        weight_decay=float(config.get("weight_decay", 0.01)),
    )
    gradient_accumulation_steps = int(config.get("gradient_accumulation_steps", 2))
    epochs = int(config.get("epochs", 4))
    update_steps_per_epoch = math.ceil(len(train_loader) / gradient_accumulation_steps)
    total_steps = max(update_steps_per_epoch * epochs, 1)
    warmup_steps = int(total_steps * float(config.get("warmup_ratio", 0.06)))
    scheduler = get_linear_schedule_with_warmup(optimizer, warmup_steps, total_steps)
    scaler = torch.cuda.amp.GradScaler(enabled=fp16)
    asymmetric = config.get("asymmetric_loss", {})

    best_macro_f1 = -1.0
    best_payload = {}
    for epoch in range(1, epochs + 1):
        student_model.train()
        teacher_model.eval()
        optimizer.zero_grad(set_to_none=True)
        total_loss = 0.0
        for step, batch in enumerate(tqdm(train_loader, desc="distill", leave=False), start=1):
            labels = batch["labels"].to(device)
            student_inputs = encode_batch(
                student_tokenizer,
                batch["texts"],
                int(config.get("max_length", 256)),
                int(config.get("head_tokens", 200)),
                int(config.get("tail_tokens", 50)),
                device,
            )
            teacher_inputs = encode_batch(
                teacher_tokenizer,
                batch["texts"],
                int(config.get("max_length", 256)),
                int(config.get("head_tokens", 200)),
                int(config.get("tail_tokens", 50)),
                device,
            )
            with torch.no_grad():
                teacher_logits = teacher_model(**teacher_inputs).logits
            with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=fp16):
                student_logits = student_model(**student_inputs).logits
                loss = distillation_loss(
                    student_logits,
                    teacher_logits,
                    labels,
                    supervised_loss_name=config.get("supervised_loss", "asl"),
                    distillation_alpha=float(config.get("distillation_alpha", 0.4)),
                    temperature=float(config.get("temperature", 2.0)),
                    gamma_pos=float(asymmetric.get("gamma_pos", 0.0)),
                    gamma_neg=float(asymmetric.get("gamma_neg", 4.0)),
                    clip=float(asymmetric.get("clip", 0.05)),
                )
                loss = loss / gradient_accumulation_steps

            scaler.scale(loss).backward()
            if step % gradient_accumulation_steps == 0 or step == len(train_loader):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(student_model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)
            total_loss += loss.item() * gradient_accumulation_steps

        y_valid, probabilities = predict_student_probabilities(student_model, student_tokenizer, valid_loader, config, device)
        thresholds = find_best_thresholds(y_valid, probabilities)
        metrics = compute_multilabel_metrics(y_valid, probabilities, thresholds)
        metrics["train_loss"] = float(total_loss / max(len(train_loader), 1))
        metrics["epoch"] = epoch
        print(
            f"epoch={epoch} loss={metrics['train_loss']:.4f} "
            f"macro_f1={metrics['macro_f1']:.4f} micro_f1={metrics['micro_f1']:.4f}"
        )

        if metrics["macro_f1"] > best_macro_f1:
            best_macro_f1 = metrics["macro_f1"]
            best_payload = {"metrics": metrics, "thresholds": thresholds}
            student_model.save_pretrained(output_dir)
            student_tokenizer.save_pretrained(output_dir)
            save_json(output_dir / "thresholds.json", thresholds)
            save_json(output_dir / "metrics.json", metrics)

    baseline_metrics = {}
    baseline_model_dir = config.get("release_gate", {}).get("baseline_model_dir")
    if baseline_model_dir and (Path(baseline_model_dir) / "metrics.json").exists():
        baseline_metrics = json.loads((Path(baseline_model_dir) / "metrics.json").read_text(encoding="utf-8"))
    gate_config = config.get("release_gate", {})
    gate = evaluate_release_gate(
        best_payload.get("metrics", {}),
        baseline_metrics,
        min_macro_improvement=float(gate_config.get("min_macro_improvement", 0.015)),
        min_macro_f1=gate_config.get("min_macro_f1"),
        long_tail_labels=tuple(gate_config.get("long_tail_labels", ["threat", "identity_hate"])),
    )
    save_json(
        output_dir / "training_config.json",
        {
            "model_name": config["model_name"],
            "teacher_dir": teacher_dir,
            "labels": LABELS,
            "max_length": int(config.get("max_length", 256)),
            "head_tokens": int(config.get("head_tokens", 200)),
            "tail_tokens": int(config.get("tail_tokens", 50)),
            "supervised_loss": config.get("supervised_loss", "asl"),
            "distillation_alpha": float(config.get("distillation_alpha", 0.4)),
            "temperature": float(config.get("temperature", 2.0)),
            "epochs": epochs,
            "batch_size": int(config.get("batch_size", 8)),
            "gradient_accumulation_steps": gradient_accumulation_steps,
            "release_gate": gate,
        },
    )
    save_json(output_dir / "release_gate.json", gate)
    return {"metrics": best_payload.get("metrics", {}), "thresholds": best_payload.get("thresholds", {}), "release_gate": gate}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distill a high-accuracy toxic-comment teacher into a fast student.")
    parser.add_argument("--config", default="configs/student_minilm_distill.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = train_student(load_json_config(args.config))
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
