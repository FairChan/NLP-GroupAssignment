from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from transformers import AutoModelForSequenceClassification, AutoTokenizer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.toxic_detector.config import DEFAULT_HEAD_TOKENS, DEFAULT_MAX_LENGTH, DEFAULT_TAIL_TOKENS, LABELS
from src.toxic_detector.data import load_jigsaw_train, multilabel_train_valid_split
from src.toxic_detector.metrics import compute_multilabel_metrics, find_best_thresholds, save_json
from src.toxic_detector.train_transformer import ToxicCommentDataset, predict_probabilities


def load_length_config(model_dir: str | Path) -> dict[str, int]:
    config_path = Path(model_dir) / "training_config.json"
    if not config_path.exists():
        return {
            "max_length": DEFAULT_MAX_LENGTH,
            "head_tokens": DEFAULT_HEAD_TOKENS,
            "tail_tokens": DEFAULT_TAIL_TOKENS,
        }
    config = json.loads(config_path.read_text(encoding="utf-8"))
    return {
        "max_length": int(config.get("max_length", DEFAULT_MAX_LENGTH)),
        "head_tokens": int(config.get("head_tokens", DEFAULT_HEAD_TOKENS)),
        "tail_tokens": int(config.get("tail_tokens", DEFAULT_TAIL_TOKENS)),
    }


def evaluate_transformer(args: argparse.Namespace) -> dict:
    frame = load_jigsaw_train(args.data_path)
    _, valid_frame = multilabel_train_valid_split(
        frame,
        valid_size=args.valid_size,
        random_state=args.seed,
    )
    lengths = load_length_config(args.model_dir)
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir)
    dataset = ToxicCommentDataset(
        valid_frame["comment_text"],
        valid_frame[LABELS].to_numpy(),
        tokenizer,
        max_length=lengths["max_length"],
        head_tokens=lengths["head_tokens"],
        tail_tokens=lengths["tail_tokens"],
    )
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=True,
    )
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    model = AutoModelForSequenceClassification.from_pretrained(args.model_dir).to(device)
    y_true, probabilities = predict_probabilities(model, loader, device)
    thresholds = find_best_thresholds(y_true, probabilities)
    metrics = compute_multilabel_metrics(y_true, probabilities, thresholds)
    metrics["model_dir"] = str(args.model_dir)
    metrics["data_path"] = str(args.data_path)
    metrics["valid_size"] = args.valid_size
    metrics["seed"] = args.seed
    metrics["validation_rows"] = int(len(valid_frame))
    if args.output:
        save_json(args.output, metrics)
    return metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a saved Transformer model on a fixed validation split.")
    parser.add_argument("--data-path", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output", default=None)
    parser.add_argument("--valid-size", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args()


def main() -> None:
    metrics = evaluate_transformer(parse_args())
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
