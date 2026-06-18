from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.toxic_detector.config import LABELS
from src.toxic_detector.tokenization import encode_head_tail


SAMPLES = [
    "Thanks for the explanation, this is helpful.",
    "You are stupid and I hate you.",
    "I will hurt you if you come here again.",
    "People from that group deserve respect and safety.",
]


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-values))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check extension ONNX output against PyTorch model output.")
    parser.add_argument("--model-dir", default="artifacts/distilbert")
    parser.add_argument("--onnx-path", default="extension/model/model.onnx")
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--atol", type=float, default=1e-3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_dir = Path(args.model_dir)
    onnx_path = Path(args.onnx_path)
    training_config_path = model_dir / "training_config.json"
    training_config = (
        json.loads(training_config_path.read_text(encoding="utf-8"))
        if training_config_path.exists()
        else {}
    )
    max_length = int(training_config.get("max_length", args.max_length))
    head_tokens = int(training_config.get("head_tokens", 200))
    tail_tokens = int(training_config.get("tail_tokens", 50))

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    model.eval()

    encoded = [
        encode_head_tail(
            tokenizer,
            sample,
            max_length=max_length,
            head_tokens=head_tokens,
            tail_tokens=tail_tokens,
        )
        for sample in SAMPLES
    ]
    input_ids = np.array([row["input_ids"] for row in encoded], dtype=np.int64)
    attention_mask = np.array([row["attention_mask"] for row in encoded], dtype=np.int64)

    with torch.no_grad():
        torch_logits = (
            model(
                input_ids=torch.from_numpy(input_ids),
                attention_mask=torch.from_numpy(attention_mask),
            )
            .logits.cpu()
            .numpy()
        )

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    onnx_logits = session.run(
        ["logits"],
        {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
        },
    )[0]

    max_diff = float(np.max(np.abs(torch_logits - onnx_logits)))
    if max_diff > args.atol:
        raise SystemExit(f"ONNX parity failed: max absolute diff {max_diff:.6f} > {args.atol}")

    probabilities = sigmoid(onnx_logits)
    print(f"ONNX parity ok: max absolute diff {max_diff:.6f}")
    for sample, row in zip(SAMPLES, probabilities):
        highest = int(np.argmax(row))
        print(f"- {LABELS[highest]}={row[highest]:.4f} | {sample[:60]}")


if __name__ == "__main__":
    main()
