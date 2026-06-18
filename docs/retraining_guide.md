# High-Performance Retraining Guide

This project now supports an accuracy-first retraining path with a fast browser target:

1. Reproduce the current DistilBERT baseline.
2. Train high-accuracy ModernBERT and DeBERTa-v3 teacher experiments.
3. Select the best teacher checkpoint by validation Macro F1.
4. Distill the best teacher into a MiniLM student for browser inference.
5. Export ONNX, run dynamic INT8 quantization, benchmark size/latency, and apply the release gate.

The default scope remains English toxic-comment detection with the existing six Jigsaw labels.

Optional supplemental CSVs can be placed at:

- `data/aux/identity_neutral.csv` for non-toxic identity mentions.
- `data/aux/toxigen_weak.csv` for weak `toxic` / `identity_hate` supervision.

If these files are absent, training falls back to the Jigsaw dataset without failing.

## Commands

Use the existing Python 3.11 conda environment:

```powershell
conda activate toxic-nlp
pip install -r requirements.txt
.\scripts\train_high_performance.ps1
```

For shorter smoke runs while checking setup:

```powershell
.\scripts\train_high_performance.ps1 -SkipTeachers -SkipStudent
```

Individual commands:

```powershell
python -m src.toxic_detector.train_teacher --config configs\teacher_modernbert.json
python -m src.toxic_detector.train_teacher --config configs\teacher_deberta_v3.json
python scripts\select_best_teacher.py
python -m src.toxic_detector.distill_student --config configs\student_minilm_distill.json
python scripts\export_extension_model.py --config configs\export_int8.json
python scripts\benchmark_extension_model.py --config configs\export_int8.json
```

## Model Roles

- ModernBERT teacher: primary accuracy-first model candidate.
- DeBERTa-v3 teacher: strong comparison model for semantic understanding.
- MiniLM student: fast plugin candidate after distillation.
- Current DistilBERT: production fallback if the student fails the release gate.

## Release Gate

Do not replace `extension/model` unless the candidate passes all checks:

- Macro F1 is at least `0.741`, equivalent to current `0.726 + 0.015`.
- `threat` F1 does not regress.
- `identity_hate` F1 does not regress.
- Quantized ONNX stays within the configured size budget, currently 150 MB.
- ONNX/quantized output drift stays within the configured parity budget.

If the MiniLM student fails, keep the current DistilBERT extension model and use the teacher results only for analysis, threshold tuning, or a future distillation run.

## Expected Outputs

- `artifacts/teacher_modernbert/best`
- `artifacts/teacher_deberta_v3/best`
- `artifacts/teacher_best`
- `artifacts/student_minilm_distilled`
- `extension/model/model.onnx`
- `extension/model/model_quantized.onnx` when dynamic quantization succeeds
- `artifacts/model_cards/retrain_report.md`
- `artifacts/model_cards/extension_benchmark.json`

## Notes

Teacher training is intentionally slower and may take a long time on an 8 GB GPU. Use the provided small batch sizes and gradient accumulation rather than increasing batch size first. The plugin should only ship a single distilled and quantized model; teacher ensembles are for offline selection, not browser deployment.
