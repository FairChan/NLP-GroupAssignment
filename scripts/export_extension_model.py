from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.toxic_detector.config import LABELS


def update_label_mapping(model_dir: Path) -> None:
    config_path = model_dir / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["id2label"] = {str(index): label for index, label in enumerate(LABELS)}
    config["label2id"] = {label: index for index, label in enumerate(LABELS)}
    config["problem_type"] = "multi_label_classification"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def copy_metadata(model_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename in [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "vocab.txt",
        "thresholds.json",
        "training_config.json",
    ]:
        source = model_dir / filename
        if source.exists():
            shutil.copy2(source, output_dir / filename)

    (output_dir / "labels.json").write_text(
        json.dumps({"labels": LABELS}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def export_onnx(model_dir: Path, output_dir: Path, max_length: int = 256) -> Path:
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    model.eval()

    sample = tokenizer(
        "This is a sample comment for toxic comment detection.",
        padding="max_length",
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )
    onnx_path = output_dir / "model.onnx"
    external_data_path = output_dir / "model.onnx.data"
    if external_data_path.exists():
        external_data_path.unlink()
    torch.onnx.export(
        model,
        (sample["input_ids"], sample["attention_mask"]),
        onnx_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        external_data=False,
    )
    return onnx_path


def quantize_onnx(onnx_path: Path, output_dir: Path) -> Path | None:
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantized_path = output_dir / "model_quantized.onnx"
        quantize_dynamic(
            model_input=str(onnx_path),
            model_output=str(quantized_path),
            weight_type=QuantType.QInt8,
        )
        return quantized_path
    except Exception as exc:
        print(f"Quantization skipped: {exc}")
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export trained DistilBERT model for the browser extension.")
    parser.add_argument("--model-dir", default="artifacts/distilbert")
    parser.add_argument("--output-dir", default="extension/model")
    parser.add_argument("--max-length", type=int, default=256)
    return parser.parse_args()


def main() -> None:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    args = parse_args()
    model_dir = Path(args.model_dir)
    output_dir = Path(args.output_dir)
    if not model_dir.exists():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")

    update_label_mapping(model_dir)
    copy_metadata(model_dir, output_dir)
    onnx_path = export_onnx(model_dir, output_dir, max_length=args.max_length)
    quantized_path = quantize_onnx(onnx_path, output_dir)
    print(f"Exported ONNX model: {onnx_path}")
    if quantized_path:
        print(f"Exported quantized ONNX model: {quantized_path}")
    print(f"Extension model assets ready in: {output_dir}")


if __name__ == "__main__":
    main()
