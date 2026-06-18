from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def _load_report(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def select_best_teacher(report_paths: list[str | Path], output_dir: str | Path) -> dict:
    candidates = []
    for report_path in report_paths:
        report = _load_report(Path(report_path))
        best = report.get("best") or {}
        run_dir = best.get("run_dir")
        metrics = best.get("metrics") or {}
        if run_dir and Path(run_dir).exists():
            candidates.append(
                {
                    "report_path": str(report_path),
                    "source_dir": str(Path(run_dir)),
                    "metrics": metrics,
                    "macro_f1": float(metrics.get("macro_f1", -1.0)),
                }
            )

    if not candidates:
        raise FileNotFoundError("No completed teacher experiment reports were found.")

    selected = max(candidates, key=lambda item: item["macro_f1"])
    destination = Path(output_dir)
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(selected["source_dir"], destination)

    payload = {
        "selected_dir": str(destination),
        "source_dir": selected["source_dir"],
        "report_path": selected["report_path"],
        "metrics": selected["metrics"],
    }
    (destination / "selected_teacher.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Select the best teacher checkpoint by validation Macro F1.")
    parser.add_argument(
        "--reports",
        nargs="+",
        default=[
            "artifacts/teacher_modernbert/teacher_experiments.json",
            "artifacts/teacher_deberta_v3/teacher_experiments.json",
        ],
    )
    parser.add_argument("--output-dir", default="artifacts/teacher_best")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    print(json.dumps(select_best_teacher(args.reports, args.output_dir), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
