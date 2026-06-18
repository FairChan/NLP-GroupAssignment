# Thread Memory: model-optimization


## 2026-06-16 21:20 中国标准时间 - Ran DistilBERT optimization experiments

Actor: Codex
Thread: model-optimization
Purpose: work

Summary:
- Ran DistilBERT optimization experiments

Details:
  Fixed tokenizer warning by passing verbose=False before head-tail truncation. Ran three optimization experiments without overwriting baseline: lr=1e-5/e5 from scratch, baseline continuation lr=5e-6/e2, and ASL gamma_neg=3/lr=2e-5/e3. Baseline remains best single model with macro_f1 0.726010; gamma_neg=3 is close at 0.725331 and improves identity_hate. Added docs/model_optimization_log.md with results.

Files touched:
- src/toxic_detector/tokenization.py
- tests/test_tokenization.py
- docs/model_optimization_log.md
- artifacts/distilbert_lr1e5_e5
- artifacts/distilbert_cont_lr5e6_e2
- artifacts/distilbert_gn3_lr2e5_e3
- logs

Tests:
- python -m unittest discover -s tests -v passed: 8 tests

Risks:
- Artifacts and logs are local generated outputs and should not be committed unless explicitly desired. Existing unrelated extension and memory changes remain untouched.

Next:
- Keep artifacts/distilbert as default model; next experiment should try capped BCE pos_weight or ASL gamma_neg=4.5 for long-tail labels.
