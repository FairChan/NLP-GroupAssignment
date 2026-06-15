from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

from src.toxic_detector.config import LABELS
from src.toxic_detector.preprocessing import clean_text


def load_jigsaw_train(path: str | Path) -> pd.DataFrame:
    dataset_path = Path(path)
    if not dataset_path.exists():
        raise FileNotFoundError(f"Training data not found: {dataset_path}")

    frame = pd.read_csv(dataset_path)
    required = {"comment_text", *LABELS}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

    frame = frame[["comment_text", *LABELS]].copy()
    frame["comment_text"] = frame["comment_text"].map(clean_text)
    frame = frame[frame["comment_text"].str.len() > 0].reset_index(drop=True)
    frame[LABELS] = frame[LABELS].astype("float32")
    return frame


def multilabel_train_valid_split(
    frame: pd.DataFrame,
    valid_size: float = 0.1,
    random_state: int = 42,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    labels = frame[LABELS].astype(int).to_numpy()
    try:
        from iterstrat.ml_stratifiers import MultilabelStratifiedShuffleSplit

        splitter = MultilabelStratifiedShuffleSplit(
            n_splits=1,
            test_size=valid_size,
            random_state=random_state,
        )
        train_idx, valid_idx = next(splitter.split(frame["comment_text"], labels))
        return frame.iloc[train_idx].reset_index(drop=True), frame.iloc[valid_idx].reset_index(drop=True)
    except ImportError:
        toxic_any = (labels.sum(axis=1) > 0).astype(int)
        train, valid = train_test_split(
            frame,
            test_size=valid_size,
            random_state=random_state,
            stratify=toxic_any,
        )
        return train.reset_index(drop=True), valid.reset_index(drop=True)
