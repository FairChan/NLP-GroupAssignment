from dataclasses import dataclass

from src.toxic_detector.config import LABELS

HIGH_PROBABILITY_BLOCK_THRESHOLD = 0.80
BLOCK_LABELS = {"severe_toxic", "threat"}


@dataclass
class ModerationDecision:
    flagged: bool
    flagged_labels: list[str]
    highest_label: str
    highest_score: float
    risk_level: str
    action: str


def decide_moderation(scores: dict[str, float], thresholds: dict[str, float]) -> ModerationDecision:
    missing_scores = [label for label in LABELS if label not in scores]
    if missing_scores:
        raise ValueError(f"Missing scores for labels: {', '.join(missing_scores)}")

    missing_thresholds = [label for label in LABELS if label not in thresholds]
    if missing_thresholds:
        raise ValueError(f"Missing thresholds for labels: {', '.join(missing_thresholds)}")

    flagged_labels = [
        label for label in LABELS if float(scores[label]) >= float(thresholds[label])
    ]
    highest_label = max(LABELS, key=lambda label: float(scores[label]))
    highest_score = float(scores[highest_label])
    flagged = bool(flagged_labels)

    should_block = (
        any(label in BLOCK_LABELS for label in flagged_labels)
        or highest_score >= HIGH_PROBABILITY_BLOCK_THRESHOLD
    )
    if should_block:
        action = "block"
        risk_level = "high"
    elif flagged:
        action = "review"
        risk_level = "medium"
    else:
        action = "allow"
        risk_level = "low"

    return ModerationDecision(
        flagged=flagged,
        flagged_labels=flagged_labels,
        highest_label=highest_label,
        highest_score=highest_score,
        risk_level=risk_level,
        action=action,
    )
