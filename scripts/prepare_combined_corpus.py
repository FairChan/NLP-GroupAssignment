from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.toxic_detector.config import LABELS
from src.toxic_detector.preprocessing import clean_text


DEFAULT_SOURCES = [
    ("jigsaw", "data/raw/train.csv", "comment_text"),
    ("youtube", "data/raw/youtube/dataset_labeled.csv", "text"),
    ("googleplay", "data/raw/googleplay/dataset_labeled.csv", "text"),
    ("civil", "data/Civil/dataset_labeled.csv", "text"),
    ("steam", "data/steam/dataset_labeled.csv", "text"),
]


def _parse_source(value: str) -> tuple[str, Path, str | None]:
    parts = value.split(":", 2)
    if len(parts) not in (2, 3):
        raise argparse.ArgumentTypeError(
            "source must use name:path or name:path:text_column format, for example youtube:data/raw/youtube/dataset_labeled.csv:text"
        )
    text_column = parts[2] if len(parts) == 3 and parts[2] else None
    return parts[0], Path(parts[1]), text_column


def _detect_text_column(frame: pd.DataFrame, source_path: Path, requested_column: str | None) -> str:
    if requested_column:
        if requested_column not in frame.columns:
            raise ValueError(f"{source_path} missing requested text column: {requested_column}")
        return requested_column

    for candidate in ("comment_text", "text", "comment", "sentence", "content", "review"):
        if candidate in frame.columns:
            return candidate
    raise ValueError(f"{source_path} must contain a text column such as comment_text or text")


def _normalize_labels(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    for label in LABELS:
        normalized[label] = pd.to_numeric(normalized[label], errors="coerce").fillna(0).clip(0, 1).astype(int)
    return normalized


def _cap_negative_rows(frame: pd.DataFrame, max_negative_ratio: float | None, seed: int) -> pd.DataFrame:
    if max_negative_ratio is None or max_negative_ratio < 0:
        return frame

    positive_mask = frame[LABELS].sum(axis=1) > 0
    positives = frame[positive_mask]
    negatives = frame[~positive_mask]
    if positives.empty:
        keep_count = min(len(negatives), int(max_negative_ratio))
    else:
        keep_count = min(len(negatives), int(round(len(positives) * max_negative_ratio)))
    if keep_count <= 0:
        return positives.reset_index(drop=True)
    sampled_negatives = negatives.sample(n=keep_count, random_state=seed) if len(negatives) > keep_count else negatives
    return pd.concat([positives, sampled_negatives], ignore_index=True)


def _cap_total_rows(frame: pd.DataFrame, max_rows: int | None, seed: int) -> pd.DataFrame:
    if max_rows is None or max_rows <= 0 or len(frame) <= max_rows:
        return frame

    positive_mask = frame[LABELS].sum(axis=1) > 0
    positives = frame[positive_mask]
    negatives = frame[~positive_mask]
    if len(positives) >= max_rows:
        return positives.sample(n=max_rows, random_state=seed).reset_index(drop=True)
    remaining = max_rows - len(positives)
    sampled_negatives = negatives.sample(n=min(remaining, len(negatives)), random_state=seed) if remaining > 0 else negatives.iloc[0:0]
    return pd.concat([positives, sampled_negatives], ignore_index=True)


def _load_source(source_name: str, path: Path, text_column: str | None, seed: int) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing source file: {path}")
    frame = pd.read_csv(path)
    detected_text_column = _detect_text_column(frame, path, text_column)
    required = {detected_text_column, *LABELS}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"{path} missing required columns: {', '.join(sorted(missing))}")

    part = frame[[detected_text_column, *LABELS]].copy()
    part = part.rename(columns={detected_text_column: "comment_text"})
    part["source_dataset"] = source_name
    part["comment_text"] = part["comment_text"].map(clean_text)
    part = part[part["comment_text"].str.len() > 0]
    part = _normalize_labels(part)
    part = (
        part.groupby(["source_dataset", "comment_text"], as_index=False)[LABELS]
        .max()
        [["comment_text", *LABELS, "source_dataset"]]
    )
    return part.sample(frac=1.0, random_state=seed).reset_index(drop=True)


def prepare_combined_data(
    sources: list[tuple[str, Path, str | None]],
    output_path: Path,
    summary_output: Path | None = None,
    max_rows_per_source: int | None = None,
    max_negative_ratio: float | None = None,
    seed: int = 42,
) -> dict:
    frames = []
    source_summaries = {}
    for source_index, (source_name, path, text_column) in enumerate(sources):
        part = _load_source(source_name, path, text_column, seed + source_index)
        original_rows = len(part)
        part = _cap_negative_rows(part, max_negative_ratio, seed + source_index)
        part = _cap_total_rows(part, max_rows_per_source, seed + source_index)
        part = part.sample(frac=1.0, random_state=seed + source_index).reset_index(drop=True)
        source_summaries[source_name] = {
            "input_rows_after_cleaning": int(original_rows),
            "output_rows": int(len(part)),
            "positive_rows": int((part[LABELS].sum(axis=1) > 0).sum()),
            "negative_rows": int((part[LABELS].sum(axis=1) == 0).sum()),
            "positive_label_counts": part[LABELS].sum().astype(int).to_dict(),
        }
        frames.append(part)

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["comment_text", *LABELS]).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined[["comment_text", *LABELS, "source_dataset"]].to_csv(output_path, index=False)

    summary = {
        "output": str(output_path),
        "rows": int(len(combined)),
        "source_counts": combined["source_dataset"].value_counts().to_dict(),
        "positive_label_counts": combined[LABELS].sum().astype(int).to_dict(),
        "any_toxic_rows": int((combined[LABELS].sum(axis=1) > 0).sum()),
        "sources": source_summaries,
        "max_rows_per_source": max_rows_per_source,
        "max_negative_ratio": max_negative_ratio,
        "seed": seed,
    }
    if summary_output:
        summary_output.parent.mkdir(parents=True, exist_ok=True)
        summary_output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a combined CSV for the stable DistilBERT training route.")
    parser.add_argument(
        "--source",
        dest="sources",
        action="append",
        type=_parse_source,
        help="Input source in name:path:text_column format. Defaults to Jigsaw, YouTube, and Google Play.",
    )
    parser.add_argument("--output", default="artifacts/combined_stable_corpus.csv")
    parser.add_argument("--summary-output", default="artifacts/model_cards/combined_stable_corpus_summary.json")
    parser.add_argument(
        "--max-rows-per-source",
        type=int,
        default=None,
        help="Optional per-source cap. Positives are kept first, then negatives are sampled.",
    )
    parser.add_argument(
        "--max-negative-ratio",
        type=float,
        default=None,
        help="Optional easy-negative cap per source, expressed as negatives per positive row.",
    )
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sources = args.sources or [(name, Path(path), text_column) for name, path, text_column in DEFAULT_SOURCES]
    summary = prepare_combined_data(
        sources,
        Path(args.output),
        summary_output=Path(args.summary_output) if args.summary_output else None,
        max_rows_per_source=args.max_rows_per_source,
        max_negative_ratio=args.max_negative_ratio,
        seed=args.seed,
    )
    for key, value in summary.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
