from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from src.toxic_detector.config import LABELS
from src.toxic_detector.preprocessing import clean_text


def _text_column(frame: pd.DataFrame) -> str:
    for candidate in ("comment_text", "text", "comment", "sentence"):
        if candidate in frame.columns:
            return candidate
    raise ValueError("Supplemental data must include one text column: comment_text, text, comment, or sentence")


def _empty_label_frame(texts: pd.Series) -> pd.DataFrame:
    frame = pd.DataFrame({"comment_text": texts.map(clean_text)})
    for label in LABELS:
        frame[label] = 0.0
    return frame


def load_neutral_identity_csv(path: str | Path) -> pd.DataFrame:
    source = Path(path)
    frame = pd.read_csv(source)
    text_col = _text_column(frame)
    mapped = _empty_label_frame(frame[text_col])
    return mapped[mapped["comment_text"].str.len() > 0].reset_index(drop=True)


def load_toxigen_weak_csv(path: str | Path) -> pd.DataFrame:
    source = Path(path)
    frame = pd.read_csv(source)
    text_col = _text_column(frame)
    mapped = _empty_label_frame(frame[text_col])

    if "toxicity" in frame.columns:
        mapped["toxic"] = frame["toxicity"].astype(float).clip(0, 1).to_numpy()
    elif "toxic" in frame.columns:
        mapped["toxic"] = frame["toxic"].astype(float).clip(0, 1).to_numpy()
    else:
        mapped["toxic"] = 1.0

    identity_columns = [column for column in ("identity_attack", "identity_hate", "hate", "targeted_group") if column in frame.columns]
    if identity_columns:
        identity_values = frame[identity_columns].notna().astype(float).max(axis=1)
        for column in identity_columns:
            if pd.api.types.is_numeric_dtype(frame[column]):
                identity_values = pd.concat([identity_values, frame[column].astype(float).clip(0, 1)], axis=1).max(axis=1)
        mapped["identity_hate"] = identity_values.to_numpy()
    return mapped[mapped["comment_text"].str.len() > 0].reset_index(drop=True)


def append_optional_supplemental_data(frame: pd.DataFrame, supplemental_config: dict[str, Any] | None) -> pd.DataFrame:
    if not supplemental_config:
        return frame

    additions = []
    neutral_path = supplemental_config.get("neutral_identity_csv")
    if neutral_path and Path(neutral_path).exists():
        additions.append(load_neutral_identity_csv(neutral_path))

    toxigen_path = supplemental_config.get("toxigen_csv")
    if toxigen_path and Path(toxigen_path).exists():
        additions.append(load_toxigen_weak_csv(toxigen_path))

    if not additions:
        return frame

    merged = pd.concat([frame, *additions], ignore_index=True)
    merged = merged[["comment_text", *LABELS]].copy()
    merged[LABELS] = merged[LABELS].astype("float32")
    return merged.reset_index(drop=True)
