import unittest

from model_service.schemas import PredictRequest, PredictionResult
from src.toxic_detector.config import LABELS


class ApiContractTests(unittest.TestCase):
    def test_predict_request_requires_non_empty_texts(self):
        with self.assertRaises(ValueError):
            PredictRequest(texts=[])

    def test_prediction_result_contains_all_label_probabilities(self):
        scores = {label: 0.0 for label in LABELS}
        result = PredictionResult(
            text="hello",
            probabilities=scores,
            flagged=False,
            flagged_labels=[],
            highest_label="toxic",
            highest_score=0.0,
            risk_level="low",
            action="allow",
        )

        self.assertEqual(set(result.probabilities.keys()), set(LABELS))
        self.assertEqual(result.action, "allow")


if __name__ == "__main__":
    unittest.main()
