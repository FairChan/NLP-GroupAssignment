from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from types import SimpleNamespace

from src.toxic_detector.config import LABELS
from src.toxic_detector.retraining import evaluate_release_gate, experiment_name, load_json_config
from src.toxic_detector.train_transformer import train_transformer


def _training_args(config: dict, loss_name: str, seed: int, output_dir: Path) -> SimpleNamespace:
    asymmetric = config.get("asymmetric_loss", {})
    apl = config.get("apl", {})
    return SimpleNamespace(
        data_path=config.get("data_path", "data/raw/train.csv"),
        output_dir=str(output_dir),
        model_name=config["model_name"],
        valid_size=float(config.get("valid_size", 0.1)),
        seed=int(seed),
        max_length=int(config.get("max_length", 256)),
        head_tokens=int(config.get("head_tokens", 200)),
        tail_tokens=int(config.get("tail_tokens", 50)),
        batch_size=int(config.get("batch_size", 4)),
        eval_batch_size=int(config.get("eval_batch_size", 8)),
        gradient_accumulation_steps=int(config.get("gradient_accumulation_steps", 4)),
        epochs=int(config.get("epochs", 3)),
        lr=float(config.get("lr", 2e-5)),
        weight_decay=float(config.get("weight_decay", 0.01)),
        warmup_ratio=float(config.get("warmup_ratio", 0.06)),
        loss=loss_name,
        gamma_pos=float(asymmetric.get("gamma_pos", 0.0)),
        gamma_neg=float(asymmetric.get("gamma_neg", 4.0)),
        asl_clip=float(asymmetric.get("clip", 0.05)),
        apl_epsilon_pos=float(apl.get("epsilon_pos", 1.0)),
        apl_epsilon_neg=float(apl.get("epsilon_neg", 1.0)),
        num_workers=int(config.get("num_workers", 0)),
        fp16=bool(config.get("fp16", True)),
        cpu=bool(config.get("cpu", False)),
        supplemental_data=config.get("supplemental_data"),
    )


def _load_metrics(path: Path) -> dict:
    metrics_path = path / "metrics.json"
    if not metrics_path.exists():
        return {}
    return json.loads(metrics_path.read_text(encoding="utf-8"))


def _copy_best_checkpoint(source_dir: Path, best_dir: Path) -> None:
    if best_dir.exists():
        shutil.rmtree(best_dir)
    shutil.copytree(source_dir, best_dir)


def run_teacher_experiments(config: dict) -> dict:
    output_root = Path(config["output_dir"])
    output_root.mkdir(parents=True, exist_ok=True)

    baseline_metrics = {}
    baseline_model_dir = config.get("release_gate", {}).get("baseline_model_dir")
    if baseline_model_dir:
        baseline_metrics = _load_metrics(Path(baseline_model_dir))

    summaries = []
    best_summary: dict | None = None
    best_dir: Path | None = None
    for loss_name in config.get("losses", ["asl"]):
        for seed in config.get("seeds", [42]):
            run_name = experiment_name(config["model_name"], loss_name, int(seed))
            run_dir = output_root / run_name
            args = _training_args(config, str(loss_name), int(seed), run_dir)
            payload = train_transformer(args)
            metrics = payload.get("metrics") or _load_metrics(run_dir)
            gate_config = config.get("release_gate", {})
            gate = evaluate_release_gate(
                metrics,
                baseline_metrics,
                min_macro_improvement=float(gate_config.get("min_macro_improvement", 0.015)),
                min_macro_f1=gate_config.get("min_macro_f1"),
                long_tail_labels=tuple(gate_config.get("long_tail_labels", ["threat", "identity_hate"])),
            )
            summary = {
                "run_name": run_name,
                "run_dir": str(run_dir),
                "loss": loss_name,
                "seed": int(seed),
                "metrics": metrics,
                "release_gate": gate,
            }
            summaries.append(summary)
            if best_summary is None or float(metrics.get("macro_f1", -1.0)) > float(
                best_summary.get("metrics", {}).get("macro_f1", -1.0)
            ):
                best_summary = summary
                best_dir = run_dir

    if best_dir and best_summary:
        _copy_best_checkpoint(best_dir, output_root / "best")

    report = {
        "model_name": config["model_name"],
        "labels": LABELS,
        "runs": summaries,
        "best": best_summary,
        "best_dir": str(output_root / "best") if best_summary else None,
    }
    (output_root / "teacher_experiments.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run high-accuracy teacher toxic-comment experiments.")
    parser.add_argument("--config", default="configs/teacher_modernbert.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = run_teacher_experiments(load_json_config(args.config))
    print(json.dumps(report.get("best", {}), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
