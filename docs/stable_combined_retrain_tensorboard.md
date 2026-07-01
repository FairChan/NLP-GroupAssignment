# Stable DistilBERT Combined-Corpus Retraining

This is the safe retraining route for the current extension model. It keeps the original DistilBERT + ASL method, combines the local English datasets, and writes training curves to TensorBoard. It does not replace `extension/model` automatically.

## Data Sources

The default corpus builder reads:

- `data/raw/train.csv`
- `data/raw/youtube/dataset_labeled.csv`
- `data/raw/googleplay/dataset_labeled.csv`
- `data/Civil/dataset_labeled.csv`
- `data/steam/dataset_labeled.csv`

Output:

- Corpus: `artifacts/combined_stable_corpus.csv`
- Corpus summary: `artifacts/model_cards/combined_stable_corpus_summary.json`
- Candidate model: `artifacts/distilbert_stable_combined`
- TensorBoard logs: `logs/tensorboard/distilbert_stable_combined`

## Run

From PowerShell in `C:\Users\ssema\Desktop\nlpga`:

```powershell
conda activate toxic-nlp
.\scripts\train_stable_combined_tensorboard.ps1 -LaunchTensorBoard
```

Then open:

```text
http://127.0.0.1:6006
```

To continue from the current stable local checkpoint instead of starting from the public DistilBERT weights:

```powershell
.\scripts\train_stable_combined_tensorboard.ps1 -InitModelDir artifacts\distilbert_repro -LaunchTensorBoard
```

## Notes

The script uses source-aware sampling by default:

- `MaxRowsPerSource = 50000`
- `MaxNegativeRatio = 4.0`

That keeps Jigsaw from drowning out the new smaller sources and limits easy neutral examples. After training, compare the new `metrics.json` against `artifacts/distilbert_repro/metrics.json` before exporting anything to the browser extension.

## Latest Local Run

The latest full run generated `artifacts/combined_stable_corpus.csv` with 75,375 rows:

| Source | Rows |
| --- | ---: |
| Jigsaw | 50,000 |
| Civil | 8,000 |
| YouTube | 8,000 |
| Steam | 6,700 |
| Google Play | 2,675 |

Fair comparison on the same combined validation split:

| Model | Macro F1 | Micro F1 | Threat F1 | Identity Hate F1 |
| --- | ---: | ---: | ---: | ---: |
| `artifacts/distilbert_repro` | 0.687557 | 0.785579 | 0.630137 | 0.548077 |
| `artifacts/distilbert_stable_combined` | 0.677441 | 0.789445 | 0.524590 | 0.590909 |

Decision: keep `artifacts/distilbert_repro` as the extension model for now. The combined candidate improved `identity_hate` recall/F1, but it regressed `macro_f1`, `threat`, and `severe_toxic`, which are important blocking labels.
