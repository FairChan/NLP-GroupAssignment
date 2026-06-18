from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F

from src.toxic_detector.config import LABELS
from src.toxic_detector.losses import AsymmetricLoss, AsymmetricPolynomialLoss

LONG_TAIL_LABELS = ("threat", "identity_hate")


def load_json_config(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "model"


def experiment_name(model_name: str, loss_name: str, seed: int) -> str:
    return f"{slugify(model_name)}-{slugify(loss_name)}-seed{seed}"


def supervised_multilabel_loss(
    logits: torch.Tensor,
    labels: torch.Tensor,
    loss_name: str = "asl",
    gamma_pos: float = 0.0,
    gamma_neg: float = 4.0,
    clip: float = 0.05,
    epsilon_pos: float = 1.0,
    epsilon_neg: float = 1.0,
) -> torch.Tensor:
    normalized = loss_name.lower()
    if normalized == "asl":
        return AsymmetricLoss(gamma_pos=gamma_pos, gamma_neg=gamma_neg, clip=clip)(logits, labels)
    if normalized == "apl":
        return AsymmetricPolynomialLoss(
            gamma_pos=gamma_pos,
            gamma_neg=gamma_neg,
            clip=clip,
            epsilon_pos=epsilon_pos,
            epsilon_neg=epsilon_neg,
        )(logits, labels)
    if normalized == "bce":
        return F.binary_cross_entropy_with_logits(logits, labels.float())
    raise ValueError(f"Unsupported supervised loss: {loss_name}")


def bernoulli_kl_from_logits(student_logits: torch.Tensor, teacher_logits: torch.Tensor, temperature: float) -> torch.Tensor:
    safe_temperature = max(float(temperature), 1e-6)
    teacher_probs = torch.sigmoid(teacher_logits.detach() / safe_temperature).clamp(1e-6, 1.0 - 1e-6)
    student_probs = torch.sigmoid(student_logits / safe_temperature).clamp(1e-6, 1.0 - 1e-6)
    kl_pos = teacher_probs * (teacher_probs.log() - student_probs.log())
    kl_neg = (1.0 - teacher_probs) * ((1.0 - teacher_probs).log() - (1.0 - student_probs).log())
    return (kl_pos + kl_neg).mean() * safe_temperature * safe_temperature


def distillation_loss(
    student_logits: torch.Tensor,
    teacher_logits: torch.Tensor,
    labels: torch.Tensor,
    supervised_loss_name: str = "asl",
    distillation_alpha: float = 0.4,
    temperature: float = 2.0,
    gamma_pos: float = 0.0,
    gamma_neg: float = 4.0,
    clip: float = 0.05,
) -> torch.Tensor:
    alpha = min(max(float(distillation_alpha), 0.0), 1.0)
    supervised = supervised_multilabel_loss(
        student_logits,
        labels,
        loss_name=supervised_loss_name,
        gamma_pos=gamma_pos,
        gamma_neg=gamma_neg,
        clip=clip,
    )
    distilled = bernoulli_kl_from_logits(student_logits, teacher_logits, temperature=temperature)
    return (1.0 - alpha) * supervised + alpha * distilled


def _metric_value(metrics: dict[str, Any], label: str, metric_name: str = "f1") -> float:
    value = metrics.get("per_label", {}).get(label, {}).get(metric_name)
    if value is None:
        return float("nan")
    return float(value)


def evaluate_release_gate(
    candidate_metrics: dict[str, Any],
    baseline_metrics: dict[str, Any],
    min_macro_improvement: float = 0.015,
    long_tail_labels: tuple[str, ...] = LONG_TAIL_LABELS,
    min_macro_f1: float | None = None,
) -> dict[str, Any]:
    candidate_macro = float(candidate_metrics.get("macro_f1", 0.0))
    baseline_macro = float(baseline_metrics.get("macro_f1", 0.0))
    macro_target = float(min_macro_f1) if min_macro_f1 is not None else baseline_macro + float(min_macro_improvement)

    checks: dict[str, bool] = {
        "macro_f1_target": candidate_macro >= macro_target,
    }
    details: dict[str, Any] = {
        "candidate_macro_f1": candidate_macro,
        "baseline_macro_f1": baseline_macro,
        "macro_f1_target": macro_target,
    }

    for label in long_tail_labels:
        candidate_f1 = _metric_value(candidate_metrics, label)
        baseline_f1 = _metric_value(baseline_metrics, label)
        passed = not math.isnan(candidate_f1) and not math.isnan(baseline_f1) and candidate_f1 >= baseline_f1
        check_name = f"{label}_f1_not_regressed"
        checks[check_name] = passed
        details[f"candidate_{label}_f1"] = None if math.isnan(candidate_f1) else candidate_f1
        details[f"baseline_{label}_f1"] = None if math.isnan(baseline_f1) else baseline_f1

    failed_checks = [name for name, passed in checks.items() if not passed]
    return {
        "passed": not failed_checks,
        "checks": checks,
        "failed_checks": failed_checks,
        "details": details,
    }


def build_benchmark_summary(
    model_name: str,
    onnx_path: str | Path,
    model_size_bytes: int,
    latency_ms_by_batch: dict[int, float],
    parity_max_abs_diff: float | None,
    candidate_metrics: dict[str, Any],
    baseline_metrics: dict[str, Any],
    max_model_size_mb: float = 150.0,
    max_quantized_metric_drop: float = 0.005,
    min_macro_improvement: float = 0.015,
) -> dict[str, Any]:
    model_size_mb = round(float(model_size_bytes) / (1024 * 1024), 3)
    accuracy_gate = evaluate_release_gate(
        candidate_metrics,
        baseline_metrics,
        min_macro_improvement=min_macro_improvement,
    )
    checks = {
        **accuracy_gate["checks"],
        "model_size_within_budget": model_size_mb <= float(max_model_size_mb),
    }
    if parity_max_abs_diff is not None:
        checks["onnx_parity_within_budget"] = float(parity_max_abs_diff) <= float(max_quantized_metric_drop)
    failed_checks = [name for name, passed in checks.items() if not passed]
    return {
        "model_name": model_name,
        "onnx_path": str(onnx_path),
        "model_size_mb": model_size_mb,
        "latency_ms_by_batch": {str(batch): float(latency) for batch, latency in sorted(latency_ms_by_batch.items())},
        "parity_max_abs_diff": None if parity_max_abs_diff is None else float(parity_max_abs_diff),
        "release_gate": {
            "passed": not failed_checks,
            "checks": checks,
            "failed_checks": failed_checks,
            "details": accuracy_gate["details"],
        },
    }


def write_retrain_report(path: str | Path, summaries: list[dict[str, Any]]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Retraining Report", ""]
    for summary in summaries:
        gate = summary.get("release_gate", {})
        lines.extend(
            [
                f"## {summary.get('model_name', 'model')}",
                "",
                f"- ONNX: `{summary.get('onnx_path', '')}`",
                f"- Size: {summary.get('model_size_mb', 'unknown')} MB",
                f"- Gate: {'PASS' if gate.get('passed') else 'FAIL'}",
                f"- Failed checks: {', '.join(gate.get('failed_checks', [])) or 'None'}",
                "",
            ]
        )
    destination.write_text("\n".join(lines), encoding="utf-8")
