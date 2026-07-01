from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.toxic_detector.retraining import build_benchmark_summary, load_json_config, write_retrain_report


def _load_json_if_exists(path: str | Path | None) -> dict:
    if not path:
        return {}
    source = Path(path)
    if not source.exists():
        return {}
    return json.loads(source.read_text(encoding="utf-8"))


def _model_path(output_dir: Path) -> Path:
    quantized = output_dir / "model_quantized.onnx"
    if quantized.exists():
        return quantized
    return output_dir / "model.onnx"


def _model_path_from_config(value: str | Path | None) -> Path | None:
    if not value:
        return None
    path = Path(value)
    if path.is_dir():
        return _model_path(path)
    return path


def _measure_onnx_latency(onnx_path: Path, batches: list[int], max_length: int, repeats: int = 5) -> dict[int, float]:
    try:
        import onnxruntime as ort
    except ImportError:
        return {}

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    latencies: dict[int, float] = {}
    for batch_size in batches:
        inputs = {
            "input_ids": np.ones((batch_size, max_length), dtype=np.int64),
            "attention_mask": np.ones((batch_size, max_length), dtype=np.int64),
        }
        session.run(None, inputs)
        started = time.perf_counter()
        for _ in range(repeats):
            session.run(None, inputs)
        elapsed = (time.perf_counter() - started) * 1000.0 / repeats
        latencies[int(batch_size)] = round(elapsed, 3)
    return latencies


def run_benchmark(config: dict, candidate_metrics_path: str | None = None, baseline_metrics_path: str | None = None) -> dict:
    output_dir = Path(config.get("output_dir", "extension/model"))
    onnx_path = _model_path(output_dir)
    if not onnx_path.exists():
        raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

    candidate_metrics = _load_json_if_exists(candidate_metrics_path or Path(config.get("model_dir", "")) / "metrics.json")
    baseline_metrics = _load_json_if_exists(
        baseline_metrics_path or Path(config.get("baseline_model_dir", "artifacts/distilbert_repro")) / "metrics.json"
    )
    latencies = _measure_onnx_latency(
        onnx_path,
        [int(batch) for batch in config.get("benchmark_batches", [1, 8, 16])],
        int(config.get("max_length", 256)),
    )
    speed_gate = config.get("speed_gate", {})
    baseline_onnx_path = _model_path_from_config(
        speed_gate.get("baseline_onnx_path") or config.get("baseline_onnx_path")
    )
    baseline_latencies = {}
    if baseline_onnx_path and baseline_onnx_path.exists() and baseline_onnx_path.resolve() != onnx_path.resolve():
        baseline_latencies = _measure_onnx_latency(
            baseline_onnx_path,
            [int(batch) for batch in config.get("benchmark_batches", [1, 8, 16])],
            int(speed_gate.get("baseline_max_length", config.get("baseline_max_length", config.get("max_length", 256)))),
        )
    summary = build_benchmark_summary(
        model_name=str(config.get("model_dir", "candidate")),
        onnx_path=onnx_path,
        model_size_bytes=onnx_path.stat().st_size,
        latency_ms_by_batch=latencies,
        baseline_latency_ms_by_batch=baseline_latencies,
        parity_max_abs_diff=config.get("parity_max_abs_diff"),
        candidate_metrics=candidate_metrics,
        baseline_metrics=baseline_metrics,
        max_model_size_mb=float(config.get("max_model_size_mb", 150)),
        max_quantized_metric_drop=float(config.get("max_quantized_metric_drop", 0.005)),
        min_macro_improvement=float(config.get("release_gate", {}).get("min_macro_improvement", 0.015)),
        speed_gate=speed_gate,
    )
    report_path = PROJECT_ROOT / "artifacts" / "model_cards" / "retrain_report.md"
    write_retrain_report(report_path, [summary])
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark extension ONNX model size and latency before release.")
    parser.add_argument("--config", default="configs/export_int8.json")
    parser.add_argument("--candidate-metrics")
    parser.add_argument("--baseline-metrics")
    parser.add_argument("--output-json", default="artifacts/model_cards/extension_benchmark.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = run_benchmark(
        load_json_config(args.config),
        candidate_metrics_path=args.candidate_metrics,
        baseline_metrics_path=args.baseline_metrics,
    )
    output_path = Path(args.output_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
