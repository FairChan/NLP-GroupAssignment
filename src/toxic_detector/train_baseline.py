from __future__ import annotations

import argparse
from pathlib import Path

import joblib
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from src.toxic_detector.config import LABELS
from src.toxic_detector.data import load_jigsaw_train, multilabel_train_valid_split
from src.toxic_detector.metrics import (
    compute_multilabel_metrics,
    find_best_thresholds,
    save_json,
)
from src.toxic_detector.preprocessing import TextMetaFeatureTransformer


def _text_identity(texts):
    return texts


def _build_feature_pipeline(max_word_features: int, max_char_features: int) -> FeatureUnion:
    word_features = Pipeline(
        steps=[
            ("identity", FunctionTransformer(_text_identity, validate=False)),
            (
                "tfidf",
                TfidfVectorizer(
                    lowercase=True,
                    stop_words="english",
                    ngram_range=(1, 2),
                    max_features=max_word_features,
                    min_df=2,
                    sublinear_tf=True,
                ),
            ),
        ]
    )
    char_features = Pipeline(
        steps=[
            ("identity", FunctionTransformer(_text_identity, validate=False)),
            (
                "tfidf",
                TfidfVectorizer(
                    analyzer="char_wb",
                    lowercase=True,
                    ngram_range=(3, 5),
                    max_features=max_char_features,
                    min_df=2,
                    sublinear_tf=True,
                ),
            ),
        ]
    )
    meta_features = Pipeline(
        steps=[
            ("meta", TextMetaFeatureTransformer()),
            ("scale", StandardScaler()),
        ]
    )
    return FeatureUnion(
        transformer_list=[
            ("word", word_features),
            ("char", char_features),
            ("meta", meta_features),
        ]
    )


def train_baseline(args: argparse.Namespace) -> dict:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frame = load_jigsaw_train(args.data_path)
    train_frame, valid_frame = multilabel_train_valid_split(
        frame,
        valid_size=args.valid_size,
        random_state=args.seed,
    )

    feature_pipeline = _build_feature_pipeline(
        max_word_features=args.max_word_features,
        max_char_features=args.max_char_features,
    )
    x_train = feature_pipeline.fit_transform(train_frame["comment_text"])
    x_valid = feature_pipeline.transform(valid_frame["comment_text"])

    model = OneVsRestClassifier(
        LogisticRegression(
            C=args.c,
            class_weight="balanced",
            max_iter=args.max_iter,
            solver="liblinear",
        )
    )
    model.fit(x_train, train_frame[LABELS].to_numpy())
    probabilities = model.predict_proba(x_valid)
    thresholds = find_best_thresholds(valid_frame[LABELS].to_numpy(), probabilities)
    metrics = compute_multilabel_metrics(
        valid_frame[LABELS].to_numpy(),
        probabilities,
        thresholds,
    )

    joblib.dump(
        {
            "feature_pipeline": feature_pipeline,
            "model": model,
            "labels": LABELS,
        },
        output_dir / "baseline_model.joblib",
    )
    save_json(output_dir / "thresholds.json", thresholds)
    save_json(output_dir / "metrics.json", metrics)
    return metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train TF-IDF + Logistic Regression baseline.")
    parser.add_argument("--data-path", default="data/raw/train.csv")
    parser.add_argument("--output-dir", default="artifacts/baseline")
    parser.add_argument("--valid-size", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-word-features", type=int, default=20000)
    parser.add_argument("--max-char-features", type=int, default=20000)
    parser.add_argument("--c", type=float, default=4.0)
    parser.add_argument("--max-iter", type=int, default=300)
    return parser.parse_args()


def main() -> None:
    metrics = train_baseline(parse_args())
    print("Baseline training complete.")
    print(f"Macro F1: {metrics['macro_f1']:.4f}")
    print(f"Micro F1: {metrics['micro_f1']:.4f}")
    print(f"Hamming Loss: {metrics['hamming_loss']:.4f}")


if __name__ == "__main__":
    main()
