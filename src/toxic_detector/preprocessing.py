import html
import re
import unicodedata

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
HTML_TAG_RE = re.compile(r"<[^>]+>")


def clean_text(text: str) -> str:
    value = "" if text is None else str(text)
    value = html.unescape(value)
    value = HTML_TAG_RE.sub(" ", value)
    value = URL_RE.sub(" ", value)
    value = unicodedata.normalize("NFKC", value)
    return re.sub(r"\s+", " ", value).strip()


def text_meta_features(text: str) -> list[float]:
    value = "" if text is None else str(text)
    length = max(len(value), 1)
    alpha_count = sum(ch.isalpha() for ch in value)
    uppercase_count = sum(ch.isupper() for ch in value)
    uppercase_ratio = uppercase_count / max(alpha_count, 1)
    return [
        float(length),
        float(len(value.split())),
        float(value.count("!")),
        float(value.count("?")),
        float(uppercase_ratio),
        float(sum(ch.isdigit() for ch in value) / length),
    ]


class TextMetaFeatureTransformer(BaseEstimator, TransformerMixin):
    def fit(self, texts, y=None):
        return self

    def transform(self, texts):
        return np.asarray([text_meta_features(text) for text in texts], dtype=np.float32)
