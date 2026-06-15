from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from model_service.schemas import PredictionResult
from src.toxic_detector.config import DEFAULT_MAX_LENGTH, DEFAULT_THRESHOLDS, LABELS
from src.toxic_detector.decision import decide_moderation
from src.toxic_detector.preprocessing import clean_text
from src.toxic_detector.tokenization import encode_head_tail


class ToxicityPredictor:
    def __init__(
        self,
        model_dir: str | Path,
        threshold_profile: str = "balanced",
        device: str = "auto",
        batch_size: int = 16,
        max_length: int = DEFAULT_MAX_LENGTH,
    ) -> None:
        self.model_dir = Path(model_dir)
        self.threshold_profile = threshold_profile
        self.batch_size = batch_size
        self.max_length = max_length
        self.device_name = device
        self.device = None
        self.tokenizer = None
        self.model = None
        self.torch = None
        self.thresholds = self._load_thresholds()

    @property
    def loaded(self) -> bool:
        return self.model is not None and self.tokenizer is not None

    def _load_thresholds(self) -> dict[str, float]:
        threshold_path = self.model_dir / "thresholds.json"
        if not threshold_path.exists():
            return dict(DEFAULT_THRESHOLDS)
        payload = json.loads(threshold_path.read_text(encoding="utf-8"))
        thresholds = dict(DEFAULT_THRESHOLDS)
        thresholds.update({label: float(payload[label]) for label in LABELS if label in payload})
        return thresholds

    def load(self) -> None:
        if not self.model_dir.exists():
            raise FileNotFoundError(f"Model directory does not exist: {self.model_dir}")

        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.torch = torch
        if self.device_name == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(self.device_name)

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_dir)
        self.model = AutoModelForSequenceClassification.from_pretrained(self.model_dir)
        self.model.to(self.device)
        self.model.eval()

    def _encode_batch(self, texts: list[str]):
        encoded = [
            encode_head_tail(self.tokenizer, text, max_length=self.max_length)
            for text in texts
        ]
        torch = self.torch
        return {
            "input_ids": torch.tensor([item["input_ids"] for item in encoded], dtype=torch.long),
            "attention_mask": torch.tensor(
                [item["attention_mask"] for item in encoded],
                dtype=torch.long,
            ),
        }

    def predict(self, texts: list[str]) -> list[PredictionResult]:
        if not self.loaded:
            raise RuntimeError("Model is not loaded")

        cleaned_texts = [clean_text(text) for text in texts]
        probabilities: list[np.ndarray] = []
        torch = self.torch
        for start in range(0, len(cleaned_texts), self.batch_size):
            batch_texts = cleaned_texts[start : start + self.batch_size]
            batch = self._encode_batch(batch_texts)
            with torch.no_grad():
                input_ids = batch["input_ids"].to(self.device)
                attention_mask = batch["attention_mask"].to(self.device)
                logits = self.model(input_ids=input_ids, attention_mask=attention_mask).logits
                probs = torch.sigmoid(logits).detach().cpu().numpy()
                probabilities.extend(list(probs))

        results = []
        for text, probs in zip(cleaned_texts, probabilities):
            scores = {label: float(probs[index]) for index, label in enumerate(LABELS)}
            decision = decide_moderation(scores, self.thresholds)
            results.append(
                PredictionResult(
                    text=text,
                    probabilities=scores,
                    flagged=decision.flagged,
                    flagged_labels=decision.flagged_labels,
                    highest_label=decision.highest_label,
                    highest_score=decision.highest_score,
                    risk_level=decision.risk_level,
                    action=decision.action,
                )
            )
        return results
