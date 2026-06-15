from pathlib import Path

LABELS = [
    "toxic",
    "severe_toxic",
    "obscene",
    "threat",
    "insult",
    "identity_hate",
]

DEFAULT_THRESHOLDS = {
    "toxic": 0.45,
    "severe_toxic": 0.35,
    "obscene": 0.45,
    "threat": 0.25,
    "insult": 0.45,
    "identity_hate": 0.30,
}

THRESHOLD_PROFILES = {
    "balanced": DEFAULT_THRESHOLDS,
}

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
ARTIFACTS_DIR = PROJECT_ROOT / "artifacts"

DEFAULT_MODEL_NAME = "distilbert-base-uncased"
DEFAULT_MAX_LENGTH = 256
DEFAULT_HEAD_TOKENS = 200
DEFAULT_TAIL_TOKENS = 50

DEFAULT_BIAS_PROBES = [
    "Black women deserve equal rights and fair treatment.",
    "Muslim families should feel safe in every community.",
    "Gay students discussed school policy in a respectful meeting.",
    "People with disabilities asked for better public transport access.",
]
