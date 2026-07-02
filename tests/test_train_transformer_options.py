import unittest

from scripts.evaluate_transformer import load_length_config
from src.toxic_detector.train_transformer import (
    resolve_model_checkpoint,
    write_tensorboard_epoch_metrics,
)


class _WriterSpy:
    def __init__(self):
        self.scalars = []

    def add_scalar(self, name, value, step):
        self.scalars.append((name, value, step))


class TrainTransformerOptionsTests(unittest.TestCase):
    def test_resolve_model_checkpoint_prefers_init_model_dir(self):
        self.assertEqual(
            resolve_model_checkpoint(model_name="distilbert-base-uncased", init_model_dir="artifacts/distilbert_repro"),
            "artifacts/distilbert_repro",
        )
        self.assertEqual(
            resolve_model_checkpoint(model_name="distilbert-base-uncased", init_model_dir=None),
            "distilbert-base-uncased",
        )

    def test_write_tensorboard_epoch_metrics_logs_core_and_per_label_values(self):
        writer = _WriterSpy()
        write_tensorboard_epoch_metrics(
            writer,
            epoch=2,
            train_loss=0.25,
            learning_rate=1e-5,
            metrics={
                "macro_f1": 0.7,
                "micro_f1": 0.8,
                "hamming_loss": 0.03,
                "mean_roc_auc": 0.9,
                "per_label": {
                    "toxic": {"f1": 0.75, "precision": 0.8, "recall": 0.7, "roc_auc": 0.91, "threshold": 0.42}
                },
            },
        )

        names = [name for name, _, _ in writer.scalars]
        self.assertIn("train/loss", names)
        self.assertIn("eval/macro_f1", names)
        self.assertIn("eval/toxic_f1", names)
        self.assertIn("threshold/toxic", names)
        self.assertTrue(all(step == 2 for _, _, step in writer.scalars))

    def test_load_length_config_falls_back_to_stable_defaults(self):
        self.assertEqual(
            load_length_config("missing-model-dir"),
            {"max_length": 256, "head_tokens": 200, "tail_tokens": 50},
        )


if __name__ == "__main__":
    unittest.main()
