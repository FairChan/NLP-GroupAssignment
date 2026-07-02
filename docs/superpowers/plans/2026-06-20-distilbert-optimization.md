# DistilBERT Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the browser extension to the best safe DistilBERT model and add a guarded DistilBERT optimization path.

**Architecture:** Keep failed MiniLM experiments in `artifacts/` but prevent failed release-gate models from being exported to `extension/model`. Use DistilBERT artifacts as the publishable line and run future ASL/APL experiments through a dedicated PowerShell script.

**Tech Stack:** Python 3.11, PyTorch, Transformers, ONNX export, PowerShell, unittest.

---

### Task 1: Guard model export

**Files:**
- Modify: `scripts/export_extension_model.py`
- Test: `tests/test_retraining_pipeline.py`

- [x] Add a failing test that requires export to reject `release_gate.passed=false`.
- [x] Implement `ensure_release_gate_allows_export` and wire it into config/CLI export flow.
- [x] Set `configs/export_int8.json` to require a passed release gate.

### Task 2: Add DistilBERT optimization entry

**Files:**
- Create: `scripts/train_distilbert_optimization.ps1`
- Test: `tests/test_retraining_pipeline.py`

- [x] Add a failing test that checks the script uses `distilbert-base-uncased`, ASL, APL, and `artifacts\distilbert_repro` export.
- [x] Create the PowerShell runner for ASL/APL DistilBERT experiments and safe DistilBERT export.

### Task 3: Restore extension model

**Files:**
- Modify generated assets under: `extension/model/`

- [ ] Export `artifacts/distilbert_repro` to `extension/model`.
- [ ] Verify ONNX parity against the restored DistilBERT artifact.
- [ ] Run Python and extension tests.
