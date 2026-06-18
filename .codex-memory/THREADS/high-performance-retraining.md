## 2026-06-19 01:13 中国标准时间 - Implemented high-performance retraining pipeline

Actor: codex
Thread: high-performance-retraining
Purpose: work

Summary:
- Implemented high-performance retraining pipeline

Details:
  Added an accuracy-first teacher/student retraining workflow. New configs cover ModernBERT and DeBERTa-v3 teacher experiments, MiniLM distillation, and INT8 extension export settings. Added APL-style loss support, optional neutral identity and ToxiGen weak-supervision CSV merging, teacher experiment orchestration, best-teacher selection, student distillation, extension benchmark summaries, and a PowerShell script to run the full sequence. Existing export now supports config-driven ONNX/quantization settings.

Files touched:
- README.md
- requirements.txt
- configs/teacher_modernbert.json
- configs/teacher_deberta_v3.json
- configs/student_minilm_distill.json
- configs/export_int8.json
- docs/retraining_guide.md
- scripts/train_high_performance.ps1
- scripts/select_best_teacher.py
- scripts/benchmark_extension_model.py
- scripts/export_extension_model.py
- src/toxic_detector/losses.py
- src/toxic_detector/train_transformer.py
- src/toxic_detector/retraining.py
- src/toxic_detector/supplemental_data.py
- src/toxic_detector/train_teacher.py
- src/toxic_detector/distill_student.py
- tests/test_retraining_pipeline.py

Tests:
- python -m unittest discover -s tests -v passed 16 tests
- node --test extension/tests/*.test.js passed 40 tests
- CLI help passed for train_teacher, distill_student, select_best_teacher, benchmark_extension_model, export_extension_model
- python -m compileall src scripts tests passed
- git diff --check passed with only Windows LF-to-CRLF warnings
- benchmark_extension_model smoke ran against existing extension/model/model.onnx and correctly failed release gate due size and no Macro F1 uplift

Risks:
- Full ModernBERT/DeBERTa/MiniLM training was not run in this turn because it is long-running and downloads large models. `artifacts/model_cards/` smoke output is ignored and not committed.

Next:
- Run `pip install -r requirements.txt`, then `.\scripts\train_high_performance.ps1` in the toxic-nlp environment. Replace `extension/model` only if the generated release gate passes.
