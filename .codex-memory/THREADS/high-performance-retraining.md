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

## 2026-06-30 12:55 中国标准时间 - Implemented speed-first lightweight model and extension fast path

Actor: codex
Thread: high-performance-retraining
Purpose: work

Summary:
- Implemented speed-first lightweight model and extension fast path

Details:
  Added MiniLM-L6 and TinyBERT student distillation configs, changed the default export target to an artifact candidate directory instead of `extension/model`, and extended benchmark summaries with baseline latency, speedup, and batch=1 speed gates. Unified all high-performance configs to use `artifacts/distilbert_repro` as the stable DistilBERT baseline because it matches the current extension ONNX. Optimized the extension runtime path with normalized text cache keys, visible-first candidate ordering, very-short-text fast allow, dynamic small-batch prediction, idle offscreen preload, WebGPU-first ONNX session creation with WASM fallback, and per-batch timing telemetry.

Files touched:
- configs/export_int8.json
- configs/student_minilm_l6_distill.json
- configs/student_tinybert_distill.json
- configs/student_minilm_distill.json
- configs/teacher_modernbert.json
- configs/teacher_deberta_v3.json
- docs/retraining_guide.md
- scripts/benchmark_extension_model.py
- scripts/train_high_performance.ps1
- src/toxic_detector/retraining.py
- extension/background.js
- extension/background_helpers.js
- extension/content.js
- extension/offscreen_inference.js
- extension/popup.js
- extension/tests/background_helpers.test.js
- extension/tests/background_source.test.js
- extension/tests/content_source.test.js
- extension/tests/offscreen_source.test.js
- tests/test_retraining_pipeline.py

Tests:
- node --test extension\\tests\\*.test.js passed 46 tests
- node --check extension\\supported_sites.js extension\\background.js extension\\content.js extension\\popup.js extension\\shared.js extension\\tokenizer.js extension\\background_helpers.js extension\\site_adapters.js extension\\offscreen_inference.js passed
- python -m unittest discover -s tests -v passed 26 tests with KMP_DUPLICATE_LIB_OK=TRUE
- python -m compileall src scripts tests passed
- scripts\\verify_extension_model.py --model-dir artifacts\\distilbert_repro --onnx-path extension\\model\\model.onnx passed with max abs diff 0.000002
- git diff --check passed with Windows LF-to-CRLF warnings only

Risks:
- Full teacher/student retraining was not run in this turn because it is long-running. The current stable DistilBERT plugin model remains unchanged. WebGPU is attempted first in offscreen inference but falls back to WASM if the browser/runtime cannot initialize it.

Next:
- Run `.\scripts\train_high_performance.ps1 -Target speed` in the toxic-nlp environment, inspect `artifacts\model_cards\extension_benchmark.json`, and promote a candidate into `extension\model` only if accuracy, long-tail, speed, size, and bias gates pass.
