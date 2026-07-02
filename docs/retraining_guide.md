# High-Performance Retraining Guide

This project now supports a speed-first retraining path with a high-accuracy teacher:

1. Reproduce the current DistilBERT baseline.
2. Train high-accuracy ModernBERT and DeBERTa-v3 teacher experiments.
3. Select the best teacher checkpoint by validation Macro F1.
4. Distill the best teacher into lightweight MiniLM-L6 and TinyBERT students for browser inference.
5. Export ONNX, run dynamic INT8 quantization, benchmark size/latency against the stable DistilBERT ONNX, and apply the release gate.

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

The default target is speed-first. Use `-Target balanced` if you want the older MiniLM-L12 student instead:

```powershell
.\scripts\train_high_performance.ps1 -Target balanced
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
python -m src.toxic_detector.distill_student --config configs\student_minilm_l6_distill.json
python -m src.toxic_detector.distill_student --config configs\student_tinybert_distill.json
python scripts\export_extension_model.py --config configs\export_int8.json
python scripts\benchmark_extension_model.py --config configs\export_int8.json
```

## Model Roles

- ModernBERT teacher: primary accuracy-first model candidate.
- DeBERTa-v3 teacher: strong comparison model for semantic understanding.
- MiniLM-L6 student: default speed-first plugin candidate after distillation.
- TinyBERT student: smaller fallback candidate if MiniLM-L6 is still too large or too slow.
- MiniLM-L12 student: balanced accuracy/speed candidate retained for comparison.
- Current DistilBERT: `artifacts/distilbert_repro`, the production fallback if the student fails the release gate.

## Release Gate

Do not replace `extension/model` unless the candidate passes all checks:

- Macro F1 is at least the current stable DistilBERT score for speed-first candidates.
- `threat` F1 does not regress.
- `identity_hate` F1 does not regress.
- Quantized ONNX stays within the configured size budget, currently 120 MB for MiniLM-L6.
- Browser-oriented batch=1 CPU ONNX latency is faster than the stable DistilBERT ONNX by at least the configured speedup target.
- ONNX/quantized output drift stays within the configured parity budget.

If the lightweight student fails any gate, keep the current DistilBERT extension model and use the teacher results only for analysis, threshold tuning, or a future distillation run.

## Expected Outputs

- `artifacts/teacher_modernbert/best`
- `artifacts/teacher_deberta_v3/best`
- `artifacts/teacher_best`
- `artifacts/student_minilm_l6_distilled`
- `artifacts/student_tinybert_distilled`
- `artifacts/student_minilm_distilled` when using `-Target balanced`
- `artifacts/extension_candidates/student_minilm_l6_int8/model.onnx`
- `artifacts/extension_candidates/student_minilm_l6_int8/model_quantized.onnx` when dynamic quantization succeeds
- `artifacts/model_cards/retrain_report.md`
- `artifacts/model_cards/extension_benchmark.json`

The default export path is a candidate directory, not `extension/model`. Promote a candidate to `extension/model` only after it passes the accuracy, speed, size, and bias gates.

## Notes

Teacher training is intentionally slower and may take a long time on an 8 GB GPU. Use the provided small batch sizes and gradient accumulation rather than increasing batch size first. The plugin should only ship a single distilled and quantized model; teacher ensembles are for offline selection, not browser deployment.

## Frontend Fast Path

The extension keeps the stable DistilBERT model until a student passes the gate, but the runtime path is optimized for quick classification:

- Visible comments are prioritized before offscreen comments.
- Empty and ultra-short non-informative text is allowed without ONNX inference.
- Normalized text cache keys avoid repeated inference for the same comment with different whitespace or casing.
- Small visible batches use a lower latency batch size, while backlog scans continue to use larger batches.
- The offscreen document preloads the model on supported enabled tabs and reports tokenize / inference / formatting timing without exposing raw text.
