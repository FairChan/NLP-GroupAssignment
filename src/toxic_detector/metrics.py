from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.metrics import (
    f1_score,
    hamming_loss,
    precision_recall_fscore_support,
    roc_auc_score,
)

from src.toxic_detector.config import LABELS


def sigmoid(values):
    values = np.asarray(values, dtype=np.float64)
    return 1.0 / (1.0 + np.exp(-values))


def labels_from_thresholds(probabilities, thresholds: dict[str, float]) -> np.ndarray:
    probs = np.asarray(probabilities, dtype=np.float64)
    threshold_array = np.asarray([thresholds[label] for label in LABELS], dtype=np.float64)
    return (probs >= threshold_array).astype(int)


def find_best_thresholds(
    y_true,
    probabilities,
    start: float = 0.05,
    stop: float = 0.95,
    step: float = 0.01,
) -> dict[str, float]:
    y_true = np.asarray(y_true).astype(int)
    probabilities = np.asarray(probabilities, dtype=np.float64)
    grid = np.arange(start, stop + 1e-9, step)
    thresholds: dict[str, float] = {}

    for index, label in enumerate(LABELS):
        best_threshold = 0.5
        best_f1 = -1.0
        for threshold in grid:
            predicted = (probabilities[:, index] >= threshold).astype(int)
            score = f1_score(y_true[:, index], predicted, zero_division=0)
            if score > best_f1:
                best_f1 = score
                best_threshold = float(round(threshold, 4))
        thresholds[label] = best_threshold
    return thresholds


def compute_multilabel_metrics(y_true, probabilities, thresholds: dict[str, float]) -> dict:
    y_true = np.asarray(y_true).astype(int)
    probabilities = np.asarray(probabilities, dtype=np.float64)
    y_pred = labels_from_thresholds(probabilities, thresholds)

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true,
        y_pred,
        average=None,
        zero_division=0,
    )
    per_label = {}
    for index, label in enumerate(LABELS):
        try:
            auc = roc_auc_score(y_true[:, index], probabilities[:, index])
        except ValueError:
            auc = None
        per_label[label] = {
            "precision": float(precision[index]),
            "recall": float(recall[index]),
            "f1": float(f1[index]),
            "support": int(support[index]),
            "roc_auc": None if auc is None else float(auc),
            "threshold": float(thresholds[label]),
        }

    try:
        mean_auc = roc_auc_score(y_true, probabilities, average="macro")
    except ValueError:
        mean_auc = None

    return {
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "micro_f1": float(f1_score(y_true, y_pred, average="micro", zero_division=0)),
        "hamming_loss": float(hamming_loss(y_true, y_pred)),
        "mean_roc_auc": None if mean_auc is None else float(mean_auc),
        "per_label": per_label,
    }


def save_json(path: str | Path, payload: dict) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
