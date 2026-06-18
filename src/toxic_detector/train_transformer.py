from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)

from src.toxic_detector.config import DEFAULT_MODEL_NAME, LABELS
from src.toxic_detector.data import load_jigsaw_train, multilabel_train_valid_split
from src.toxic_detector.losses import AsymmetricLoss, AsymmetricPolynomialLoss
from src.toxic_detector.metrics import (
    compute_multilabel_metrics,
    find_best_thresholds,
    save_json,
)
from src.toxic_detector.supplemental_data import append_optional_supplemental_data
from src.toxic_detector.tokenization import encode_head_tail


class ToxicCommentDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_length: int, head_tokens: int, tail_tokens: int):
        self.texts = list(texts)
        self.labels = np.asarray(labels, dtype=np.float32)
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.head_tokens = head_tokens
        self.tail_tokens = tail_tokens

    def __len__(self) -> int:
        return len(self.texts)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        encoded = encode_head_tail(
            self.tokenizer,
            self.texts[index],
            max_length=self.max_length,
            head_tokens=self.head_tokens,
            tail_tokens=self.tail_tokens,
        )
        return {
            "input_ids": torch.tensor(encoded["input_ids"], dtype=torch.long),
            "attention_mask": torch.tensor(encoded["attention_mask"], dtype=torch.long),
            "labels": torch.tensor(self.labels[index], dtype=torch.float32),
        }


def build_loss(args: argparse.Namespace, y_train: np.ndarray, device: torch.device) -> nn.Module:
    if args.loss == "asl":
        return AsymmetricLoss(
            gamma_pos=args.gamma_pos,
            gamma_neg=args.gamma_neg,
            clip=args.asl_clip,
        )
    if args.loss == "apl":
        return AsymmetricPolynomialLoss(
            gamma_pos=args.gamma_pos,
            gamma_neg=args.gamma_neg,
            clip=args.asl_clip,
            epsilon_pos=args.apl_epsilon_pos,
            epsilon_neg=args.apl_epsilon_neg,
        )

    positives = np.clip(y_train.sum(axis=0), a_min=1.0, a_max=None)
    negatives = y_train.shape[0] - positives
    pos_weight = torch.tensor(negatives / positives, dtype=torch.float32, device=device)
    return nn.BCEWithLogitsLoss(pos_weight=pos_weight)


def run_epoch(
    model,
    dataloader,
    optimizer,
    scheduler,
    loss_fn,
    device,
    scaler,
    fp16: bool,
    gradient_accumulation_steps: int,
) -> float:
    model.train()
    total_loss = 0.0
    optimizer.zero_grad(set_to_none=True)

    for step, batch in enumerate(tqdm(dataloader, desc="train", leave=False), start=1):
        input_ids = batch["input_ids"].to(device)
        attention_mask = batch["attention_mask"].to(device)
        labels = batch["labels"].to(device)

        with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=fp16):
            logits = model(input_ids=input_ids, attention_mask=attention_mask).logits
            loss = loss_fn(logits, labels) / gradient_accumulation_steps

        scaler.scale(loss).backward()
        if step % gradient_accumulation_steps == 0 or step == len(dataloader):
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)

        total_loss += loss.item() * gradient_accumulation_steps
    return total_loss / max(len(dataloader), 1)


@torch.no_grad()
def predict_probabilities(model, dataloader, device) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    all_logits = []
    all_labels = []
    for batch in tqdm(dataloader, desc="eval", leave=False):
        input_ids = batch["input_ids"].to(device)
        attention_mask = batch["attention_mask"].to(device)
        logits = model(input_ids=input_ids, attention_mask=attention_mask).logits
        all_logits.append(logits.detach().cpu())
        all_labels.append(batch["labels"])
    logits = torch.cat(all_logits).numpy()
    labels = torch.cat(all_labels).numpy()
    probabilities = 1.0 / (1.0 + np.exp(-logits))
    return labels, probabilities


def train_transformer(args: argparse.Namespace) -> dict:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frame = load_jigsaw_train(args.data_path)
    frame = append_optional_supplemental_data(frame, getattr(args, "supplemental_data", None))
    train_frame, valid_frame = multilabel_train_valid_split(
        frame,
        valid_size=args.valid_size,
        random_state=args.seed,
    )

    tokenizer = AutoTokenizer.from_pretrained(args.model_name)
    train_dataset = ToxicCommentDataset(
        train_frame["comment_text"],
        train_frame[LABELS].to_numpy(),
        tokenizer,
        max_length=args.max_length,
        head_tokens=args.head_tokens,
        tail_tokens=args.tail_tokens,
    )
    valid_dataset = ToxicCommentDataset(
        valid_frame["comment_text"],
        valid_frame[LABELS].to_numpy(),
        tokenizer,
        max_length=args.max_length,
        head_tokens=args.head_tokens,
        tail_tokens=args.tail_tokens,
    )
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=True,
    )
    valid_loader = DataLoader(
        valid_dataset,
        batch_size=args.eval_batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=True,
    )

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    fp16 = args.fp16 and device.type == "cuda"
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_name,
        num_labels=len(LABELS),
        problem_type="multi_label_classification",
    ).to(device)
    loss_fn = build_loss(args, train_frame[LABELS].to_numpy(), device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    update_steps_per_epoch = math.ceil(len(train_loader) / args.gradient_accumulation_steps)
    total_steps = max(update_steps_per_epoch * args.epochs, 1)
    warmup_steps = int(total_steps * args.warmup_ratio)
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=warmup_steps,
        num_training_steps=total_steps,
    )
    scaler = torch.cuda.amp.GradScaler(enabled=fp16)

    best_macro_f1 = -1.0
    best_payload = {}
    for epoch in range(1, args.epochs + 1):
        train_loss = run_epoch(
            model,
            train_loader,
            optimizer,
            scheduler,
            loss_fn,
            device,
            scaler,
            fp16,
            args.gradient_accumulation_steps,
        )
        y_valid, probabilities = predict_probabilities(model, valid_loader, device)
        thresholds = find_best_thresholds(y_valid, probabilities)
        metrics = compute_multilabel_metrics(y_valid, probabilities, thresholds)
        metrics["train_loss"] = float(train_loss)
        metrics["epoch"] = epoch
        print(
            f"epoch={epoch} loss={train_loss:.4f} "
            f"macro_f1={metrics['macro_f1']:.4f} micro_f1={metrics['micro_f1']:.4f}"
        )

        if metrics["macro_f1"] > best_macro_f1:
            best_macro_f1 = metrics["macro_f1"]
            best_payload = {"metrics": metrics, "thresholds": thresholds}
            model.save_pretrained(output_dir)
            tokenizer.save_pretrained(output_dir)
            save_json(output_dir / "thresholds.json", thresholds)
            save_json(output_dir / "metrics.json", metrics)

    save_json(
        output_dir / "training_config.json",
        {
            "model_name": args.model_name,
            "labels": LABELS,
            "max_length": args.max_length,
            "head_tokens": args.head_tokens,
            "tail_tokens": args.tail_tokens,
            "loss": args.loss,
            "gamma_pos": args.gamma_pos,
            "gamma_neg": args.gamma_neg,
            "asl_clip": args.asl_clip,
            "apl_epsilon_pos": getattr(args, "apl_epsilon_pos", None),
            "apl_epsilon_neg": getattr(args, "apl_epsilon_neg", None),
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "gradient_accumulation_steps": args.gradient_accumulation_steps,
        },
    )
    return best_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fine-tune DistilBERT for toxic comment detection.")
    parser.add_argument("--data-path", default="data/raw/train.csv")
    parser.add_argument("--output-dir", default="artifacts/distilbert")
    parser.add_argument("--model-name", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--valid-size", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--head-tokens", type=int, default=200)
    parser.add_argument("--tail-tokens", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--eval-batch-size", type=int, default=16)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=2)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--warmup-ratio", type=float, default=0.06)
    parser.add_argument("--loss", choices=["asl", "bce", "apl"], default="asl")
    parser.add_argument("--gamma-pos", type=float, default=0.0)
    parser.add_argument("--gamma-neg", type=float, default=4.0)
    parser.add_argument("--asl-clip", type=float, default=0.05)
    parser.add_argument("--apl-epsilon-pos", type=float, default=1.0)
    parser.add_argument("--apl-epsilon-neg", type=float, default=1.0)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--fp16", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def main() -> None:
    payload = train_transformer(parse_args())
    metrics = payload.get("metrics", {})
    print("Transformer training complete.")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
