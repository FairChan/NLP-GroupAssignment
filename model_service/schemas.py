from pydantic import BaseModel, Field, field_validator

from src.toxic_detector.config import LABELS


class PredictRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1)
    threshold_profile: str = "balanced"

    @field_validator("texts")
    @classmethod
    def validate_texts(cls, value: list[str]) -> list[str]:
        cleaned = [item for item in value if item and item.strip()]
        if not cleaned:
            raise ValueError("texts must contain at least one non-empty string")
        return cleaned


class PredictionResult(BaseModel):
    text: str
    probabilities: dict[str, float]
    flagged: bool
    flagged_labels: list[str]
    highest_label: str
    highest_score: float
    risk_level: str
    action: str

    @field_validator("probabilities")
    @classmethod
    def validate_probabilities(cls, value: dict[str, float]) -> dict[str, float]:
        missing = set(LABELS) - set(value)
        if missing:
            raise ValueError(f"missing probabilities: {', '.join(sorted(missing))}")
        return value


class PredictResponse(BaseModel):
    model_loaded: bool
    threshold_profile: str
    results: list[PredictionResult]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_dir: str
    labels: list[str]
    device: str | None = None
