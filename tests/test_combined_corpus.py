import tempfile
import unittest
from pathlib import Path

import pandas as pd

from scripts.prepare_combined_corpus import prepare_combined_data
from src.toxic_detector.config import LABELS


def _labeled_frame(text_column: str, rows: list[tuple[str, list[int]]]) -> pd.DataFrame:
    payload = {text_column: [text for text, _ in rows]}
    for index, label in enumerate(LABELS):
        payload[label] = [labels[index] for _, labels in rows]
    return pd.DataFrame(payload)


class CombinedCorpusTests(unittest.TestCase):
    def test_prepare_combined_data_normalizes_sources_and_deduplicates_texts(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            jigsaw_path = tmp_path / "jigsaw.csv"
            civil_path = tmp_path / "civil.csv"
            output_path = tmp_path / "combined.csv"
            summary_path = tmp_path / "summary.json"

            _labeled_frame(
                "comment_text",
                [
                    ("Hello <b>friend</b>", [0, 0, 0, 0, 0, 0]),
                    ("You are awful", [1, 0, 0, 0, 1, 0]),
                    ("You are awful", [1, 0, 0, 0, 1, 0]),
                ],
            ).to_csv(jigsaw_path, index=False)
            _labeled_frame(
                "text",
                [
                    ("Calm discussion", [0, 0, 0, 0, 0, 0]),
                    ("I will hurt you", [1, 0, 0, 1, 0, 0]),
                ],
            ).to_csv(civil_path, index=False)

            summary = prepare_combined_data(
                sources=[
                    ("jigsaw", jigsaw_path, "comment_text"),
                    ("civil", civil_path, None),
                ],
                output_path=output_path,
                summary_output=summary_path,
                max_rows_per_source=None,
                max_negative_ratio=None,
                seed=7,
            )

            combined = pd.read_csv(output_path)
            self.assertEqual(list(combined.columns), ["comment_text", *LABELS, "source_dataset"])
            self.assertEqual(len(combined), 4)
            self.assertEqual(combined["source_dataset"].value_counts().to_dict(), {"jigsaw": 2, "civil": 2})
            self.assertIn("Hello friend", set(combined["comment_text"]))
            self.assertEqual(summary["rows"], 4)
            self.assertTrue(summary_path.exists())

    def test_prepare_combined_data_caps_each_source_and_limits_easy_negatives(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source_path = tmp_path / "source.csv"
            output_path = tmp_path / "combined.csv"
            positives = [(f"toxic {index}", [1, 0, 0, 0, 0, 0]) for index in range(2)]
            negatives = [(f"clean {index}", [0, 0, 0, 0, 0, 0]) for index in range(20)]
            _labeled_frame("text", positives + negatives).to_csv(source_path, index=False)

            summary = prepare_combined_data(
                sources=[("small", source_path, None)],
                output_path=output_path,
                summary_output=None,
                max_rows_per_source=5,
                max_negative_ratio=1.0,
                seed=123,
            )

            combined = pd.read_csv(output_path)
            self.assertEqual(len(combined), 4)
            self.assertEqual(int((combined[LABELS].sum(axis=1) > 0).sum()), 2)
            self.assertEqual(summary["source_counts"], {"small": 4})


if __name__ == "__main__":
    unittest.main()
