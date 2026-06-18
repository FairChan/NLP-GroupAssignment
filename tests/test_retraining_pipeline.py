import json
import tempfile
import unittest
from pathlib import Path

import torch
import pandas as pd

from src.toxic_detector.config import LABELS


class RetrainingPipelineTests(unittest.TestCase):
    def test_advanced_configs_define_expected_models_and_gates(self):
        expected = {
            "teacher_modernbert.json": "answerdotai/ModernBERT-base",
            "teacher_deberta_v3.json": "microsoft/deberta-v3-base",
            "student_minilm_distill.json": "microsoft/MiniLM-L12-H384-uncased",
        }

        for filename, model_name in expected.items():
            with self.subTest(filename=filename):
                config = json.loads(Path("configs", filename).read_text(encoding="utf-8"))
                self.assertEqual(config["model_name"], model_name)
                self.assertEqual(config["labels"], LABELS)
                self.assertEqual(config["max_length"], 256)
                self.assertIn("release_gate", config)
                self.assertGreaterEqual(config["release_gate"]["min_macro_f1"], 0.741)

        export_config = json.loads(Path("configs/export_int8.json").read_text(encoding="utf-8"))
        self.assertTrue(export_config["quantize"])
        self.assertLessEqual(export_config["max_model_size_mb"], 150)

        student_config = json.loads(Path("configs/student_minilm_distill.json").read_text(encoding="utf-8"))
        self.assertEqual(student_config["teacher_dir"], "artifacts/teacher_best")

    def test_release_gate_requires_macro_and_long_tail_improvements(self):
        from src.toxic_detector.retraining import evaluate_release_gate

        baseline = {
            "macro_f1": 0.726,
            "per_label": {
                "threat": {"f1": 0.67},
                "identity_hate": {"f1": 0.63},
            },
        }
        passing = {
            "macro_f1": 0.745,
            "per_label": {
                "threat": {"f1": 0.68},
                "identity_hate": {"f1": 0.64},
            },
        }
        failing = {
            "macro_f1": 0.75,
            "per_label": {
                "threat": {"f1": 0.66},
                "identity_hate": {"f1": 0.65},
            },
        }

        decision = evaluate_release_gate(passing, baseline, min_macro_improvement=0.015)
        self.assertTrue(decision["passed"])
        self.assertEqual(decision["failed_checks"], [])

        decision = evaluate_release_gate(failing, baseline, min_macro_improvement=0.015)
        self.assertFalse(decision["passed"])
        self.assertIn("threat_f1_not_regressed", decision["failed_checks"])

    def test_distillation_loss_prefers_teacher_aligned_logits(self):
        from src.toxic_detector.retraining import distillation_loss

        labels = torch.tensor([[1, 0, 0, 1, 0, 0]], dtype=torch.float32)
        teacher_logits = torch.tensor([[3.0, -2.0, -2.0, 2.5, -1.0, -1.5]])
        aligned_student = teacher_logits.clone().requires_grad_(True)
        opposite_student = (-teacher_logits).clone().requires_grad_(True)

        aligned = distillation_loss(
            aligned_student,
            teacher_logits,
            labels,
            supervised_loss_name="bce",
            distillation_alpha=0.5,
            temperature=2.0,
        )
        opposite = distillation_loss(
            opposite_student,
            teacher_logits,
            labels,
            supervised_loss_name="bce",
            distillation_alpha=0.5,
            temperature=2.0,
        )

        self.assertLess(aligned.item(), opposite.item())
        aligned.backward()
        self.assertIsNotNone(aligned_student.grad)

    def test_asymmetric_polynomial_loss_is_finite_and_differentiable(self):
        from src.toxic_detector.losses import AsymmetricPolynomialLoss

        loss_fn = AsymmetricPolynomialLoss(gamma_pos=0.0, gamma_neg=4.0, epsilon_pos=1.0, epsilon_neg=1.0)
        logits = torch.tensor([[2.0, -2.0, 0.5, -0.5, 1.0, -1.0]], requires_grad=True)
        labels = torch.tensor([[1, 0, 1, 0, 1, 0]], dtype=torch.float32)

        loss = loss_fn(logits, labels)
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertIsNotNone(logits.grad)

    def test_benchmark_summary_tracks_size_latency_and_gate(self):
        from src.toxic_detector.retraining import build_benchmark_summary

        summary = build_benchmark_summary(
            model_name="student",
            onnx_path="extension/model/model_quantized.onnx",
            model_size_bytes=80 * 1024 * 1024,
            latency_ms_by_batch={1: 12.5, 8: 44.0},
            parity_max_abs_diff=0.004,
            candidate_metrics={"macro_f1": 0.744, "per_label": {"threat": {"f1": 0.7}, "identity_hate": {"f1": 0.65}}},
            baseline_metrics={"macro_f1": 0.726, "per_label": {"threat": {"f1": 0.67}, "identity_hate": {"f1": 0.63}}},
            max_model_size_mb=150,
        )

        self.assertTrue(summary["release_gate"]["passed"])
        self.assertEqual(summary["model_size_mb"], 80.0)
        self.assertEqual(summary["latency_ms_by_batch"]["8"], 44.0)

    def test_retraining_commands_are_documented(self):
        script = Path("scripts/train_high_performance.ps1").read_text(encoding="utf-8")
        guide = Path("docs/retraining_guide.md").read_text(encoding="utf-8")

        self.assertIn("src.toxic_detector.train_teacher", script)
        self.assertIn("scripts\\select_best_teacher.py", script)
        self.assertIn("src.toxic_detector.distill_student", script)
        self.assertIn("scripts\\export_extension_model.py --config configs\\export_int8.json", script)
        self.assertIn("ModernBERT", guide)
        self.assertIn("MiniLM", guide)
        self.assertIn("release gate", guide.lower())

    def test_best_teacher_selection_prefers_highest_macro_f1(self):
        from scripts.select_best_teacher import select_best_teacher

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            weak_model = tmp_path / "weak_model"
            strong_model = tmp_path / "strong_model"
            weak_model.mkdir()
            strong_model.mkdir()
            (weak_model / "metrics.json").write_text("{}", encoding="utf-8")
            (strong_model / "metrics.json").write_text("{}", encoding="utf-8")

            weak_report = tmp_path / "weak.json"
            strong_report = tmp_path / "strong.json"
            weak_report.write_text(
                json.dumps({"best": {"run_dir": str(weak_model), "metrics": {"macro_f1": 0.72}}}),
                encoding="utf-8",
            )
            strong_report.write_text(
                json.dumps({"best": {"run_dir": str(strong_model), "metrics": {"macro_f1": 0.75}}}),
                encoding="utf-8",
            )
            selected = select_best_teacher([weak_report, strong_report], tmp_path / "selected")

        self.assertEqual(selected["source_dir"], str(strong_model))
        self.assertEqual(selected["metrics"]["macro_f1"], 0.75)

    def test_optional_supplemental_data_maps_neutral_and_toxigen_rows(self):
        from src.toxic_detector.supplemental_data import append_optional_supplemental_data

        base = pd.DataFrame(
            {
                "comment_text": ["You are kind."],
                **{label: [0.0] for label in LABELS},
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            neutral_path = tmp_path / "neutral.csv"
            toxigen_path = tmp_path / "toxigen.csv"
            pd.DataFrame({"text": ["I am a Muslim person and I deserve respect."]}).to_csv(neutral_path, index=False)
            pd.DataFrame({"text": ["Those people are disgusting."], "toxicity": [1], "identity_attack": [1]}).to_csv(
                toxigen_path,
                index=False,
            )

            merged = append_optional_supplemental_data(
                base,
                {
                    "neutral_identity_csv": str(neutral_path),
                    "toxigen_csv": str(toxigen_path),
                },
            )

        self.assertEqual(len(merged), 3)
        self.assertEqual(float(merged.iloc[1]["identity_hate"]), 0.0)
        self.assertEqual(float(merged.iloc[2]["toxic"]), 1.0)
        self.assertEqual(float(merged.iloc[2]["identity_hate"]), 1.0)


if __name__ == "__main__":
    unittest.main()
