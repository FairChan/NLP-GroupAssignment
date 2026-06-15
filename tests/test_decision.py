import unittest

from src.toxic_detector.config import LABELS, DEFAULT_THRESHOLDS
from src.toxic_detector.decision import decide_moderation


class DecisionTests(unittest.TestCase):
    def test_all_scores_below_threshold_allows_comment(self):
        scores = {label: 0.01 for label in LABELS}

        decision = decide_moderation(scores, DEFAULT_THRESHOLDS)

        self.assertFalse(decision.flagged)
        self.assertEqual(decision.action, "allow")
        self.assertEqual(decision.risk_level, "low")
        self.assertEqual(decision.flagged_labels, [])

    def test_common_toxicity_over_threshold_goes_to_review(self):
        scores = {label: 0.01 for label in LABELS}
        scores["insult"] = 0.61

        decision = decide_moderation(scores, DEFAULT_THRESHOLDS)

        self.assertTrue(decision.flagged)
        self.assertEqual(decision.action, "review")
        self.assertEqual(decision.risk_level, "medium")
        self.assertEqual(decision.highest_label, "insult")
        self.assertEqual(decision.flagged_labels, ["insult"])

    def test_threat_over_threshold_is_blocked_even_below_high_probability(self):
        scores = {label: 0.01 for label in LABELS}
        scores["threat"] = 0.31

        decision = decide_moderation(scores, DEFAULT_THRESHOLDS)

        self.assertTrue(decision.flagged)
        self.assertEqual(decision.action, "block")
        self.assertEqual(decision.risk_level, "high")
        self.assertEqual(decision.highest_label, "threat")

    def test_any_label_at_high_probability_is_blocked(self):
        scores = {label: 0.01 for label in LABELS}
        scores["toxic"] = 0.82

        decision = decide_moderation(scores, DEFAULT_THRESHOLDS)

        self.assertTrue(decision.flagged)
        self.assertEqual(decision.action, "block")
        self.assertEqual(decision.risk_level, "high")


if __name__ == "__main__":
    unittest.main()
