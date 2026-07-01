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
    baseline_latency_ms_by_batch: dict[int, float] | None = None,
    parity_max_abs_diff: float | None = None,
    candidate_metrics: dict[str, Any] | None = None,
    baseline_metrics: dict[str, Any] | None = None,
    max_model_size_mb: float = 150.0,
    max_quantized_metric_drop: float = 0.005,
    min_macro_improvement: float = 0.015,
    speed_gate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    model_size_mb = round(float(model_size_bytes) / (1024 * 1024), 3)
    accuracy_gate = evaluate_release_gate(
        candidate_metrics or {},
        baseline_metrics or {},
        min_macro_improvement=min_macro_improvement,
    )
    candidate_latencies = {int(batch): float(latency) for batch, latency in latency_ms_by_batch.items()}
    baseline_latencies = {
        int(batch): float(latency) for batch, latency in (baseline_latency_ms_by_batch or {}).items()
    }
    speedups: dict[int, float] = {}
    for batch, candidate_latency in candidate_latencies.items():
        baseline_latency = baseline_latencies.get(batch)
        if baseline_latency and candidate_latency > 0:
            speedups[batch] = round(baseline_latency / candidate_latency, 4)

    checks = {
        **accuracy_gate["checks"],
        "model_size_within_budget": model_size_mb <= float(max_model_size_mb),
    }
    if parity_max_abs_diff is not None:
        checks["onnx_parity_within_budget"] = float(parity_max_abs_diff) <= float(max_quantized_metric_drop)
    speed_gate = speed_gate or {}
    batch1_candidate = candidate_latencies.get(1)
    batch1_baseline = baseline_latencies.get(1)
    if speed_gate.get("require_batch1_speedup"):
        checks["batch1_latency_faster_than_baseline"] = (
            batch1_candidate is not None and batch1_baseline is not None and batch1_candidate < batch1_baseline
        )
        checks["batch1_speedup_target"] = speedups.get(1, 0.0) >= float(speed_gate.get("min_batch1_speedup", 1.0))
    if speed_gate.get("max_batch1_latency_ms") is not None:
        checks["batch1_latency_within_budget"] = (
            batch1_candidate is not None and batch1_candidate <= float(speed_gate["max_batch1_latency_ms"])
        )
    for batch, max_latency in (speed_gate.get("max_latency_ms_by_batch") or {}).items():
        batch_int = int(batch)
        checks[f"batch{batch_int}_latency_within_budget"] = (
            candidate_latencies.get(batch_int) is not None
            and candidate_latencies[batch_int] <= float(max_latency)
        )

    failed_checks = [name for name, passed in checks.items() if not passed]
    details = {
        **accuracy_gate["details"],
        "candidate_batch1_latency_ms": batch1_candidate,
        "baseline_batch1_latency_ms": batch1_baseline,
        "batch1_speedup": speedups.get(1),
        "min_batch1_speedup": speed_gate.get("min_batch1_speedup"),
    }
    return {
        "model_name": model_name,
        "onnx_path": str(onnx_path),
        "model_size_mb": model_size_mb,
        "latency_ms_by_batch": {str(batch): float(latency) for batch, latency in sorted(candidate_latencies.items())},
        "baseline_latency_ms_by_batch": {
            str(batch): float(latency) for batch, latency in sorted(baseline_latencies.items())
        },
        "speedup_by_batch": {str(batch): float(speedup) for batch, speedup in sorted(speedups.items())},
        "parity_max_abs_diff": None if parity_max_abs_diff is None else float(parity_max_abs_diff),
        "release_gate": {
            "passed": not failed_checks,
            "checks": checks,
            "failed_checks": failed_checks,
            "details": details,
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
