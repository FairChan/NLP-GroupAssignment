# Combined Data DistilBERT Retraining Log

Date: 2026-06-24

## Goal

Retrain with the original DistilBERT method after adding two new English toxic-comment datasets under `data/raw/youtube` and `data/raw/googleplay`.

This run kept the old model route:

- Backbone: `distilbert-base-uncased`
- Labels: `toxic`, `severe_toxic`, `obscene`, `threat`, `insult`, `identity_hate`
- Loss: Asymmetric Loss
- `gamma_neg=4.0`
- `max_length=256`
- `batch_size=8`
- `gradient_accumulation_steps=2`
- `epochs=3`

## Data

The training file was generated at:

`artifacts/combined_old_method_train.csv`

Rows after cleaning and de-duplication:

| Source | Rows |
| --- | ---: |
| Jigsaw | 159,408 |
| YouTube | 8,000 |
| Google Play | 6,601 |
| Total | 174,009 |

Positive label counts:

| Label | Count |
| --- | ---: |
| toxic | 18,141 |
| severe_toxic | 1,720 |
| obscene | 9,314 |
| threat | 502 |
| insult | 10,623 |
| identity_hate | 1,798 |

## Training Output

Candidate model:

`artifacts/distilbert_combined_old_method`

Training log:

`logs/distilbert_combined_old_method_train.log`

Best epoch: `3`

Candidate validation metrics on the combined validation split:

| Metric | Value |
| --- | ---: |
| Macro F1 | 0.673953 |
| Micro F1 | 0.776398 |
| Hamming Loss | 0.018620 |
| Mean ROC-AUC | 0.987060 |

Per-label F1:

| Label | F1 |
| --- | ---: |
| toxic | 0.818445 |
| severe_toxic | 0.512472 |
| obscene | 0.839479 |
| threat | 0.571429 |
| insult | 0.754627 |
| identity_hate | 0.547264 |

## Fair Comparison Against Stable Plugin Model

Both models were evaluated on the same combined validation split:

| Model | Macro F1 | Micro F1 | Threat F1 | Identity Hate F1 |
| --- | ---: | ---: | ---: | ---: |
| `artifacts/distilbert_repro` | 0.732755 | 0.813663 | 0.680412 | 0.660969 |
| `artifacts/distilbert_combined_old_method` | 0.673953 | 0.776398 | 0.571429 | 0.547264 |

Comparison file:

`artifacts/model_cards/combined_old_method_comparison.json`

## Decision

Do not replace the extension model with `artifacts/distilbert_combined_old_method`.

Reason: the newly retrained model is worse than the current stable DistilBERT on the same combined validation split, especially for `threat` and `identity_hate`.

Keep the current plugin model unchanged:

`artifacts/distilbert_repro`

## Notes

The new YouTube and Google Play data are useful, but directly mixing them into the full Jigsaw training set with the old ASL recipe did not improve the deployable model. The next better experiment would be domain-adaptive fine-tuning or weighted sampling, not plain concatenation.
