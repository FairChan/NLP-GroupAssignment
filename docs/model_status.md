# Model And API Status

This project already has both a FastAPI inference service and trained DistilBERT
model artifacts. Some generated artifacts are intentionally not committed to
Git because they are large or reproducible.

## API Entrypoints

- Primary FastAPI app: `model_service/app.py`
- Compatibility alias: `api.py`
- Start command:

```powershell
uvicorn model_service.app:app --host 127.0.0.1 --port 8000
```

The following conventional command is also supported:

```powershell
uvicorn api:app --host 127.0.0.1 --port 8000
```

## Stable DistilBERT Model

The stable browser/API baseline is the DistilBERT reproduction model:

```text
artifacts/distilbert_repro
```

Its `metrics.json` is generated locally during training and is ignored by Git
via `artifacts/*`. If the artifact directory exists locally, the key validation
metrics are:

| Metric | Value |
| --- | ---: |
| Macro F1 | 0.728471 |
| Micro F1 | 0.809577 |
| Mean ROC-AUC | 0.993373 |
| Hamming Loss | 0.014205 |

Per-label F1:

| Label | F1 | Threshold |
| --- | ---: | ---: |
| toxic | 0.853270 | 0.76 |
| severe_toxic | 0.554054 | 0.57 |
| obscene | 0.854503 | 0.66 |
| threat | 0.680851 | 0.69 |
| insult | 0.792079 | 0.68 |
| identity_hate | 0.636066 | 0.58 |

## Browser Extension Model

The offline extension uses exported ONNX assets under:

```text
extension/model
```

The current packaged model is still DistilBERT. Lightweight MiniLM/TinyBERT
experiments are kept as candidates only and are not promoted unless accuracy,
latency, size, and long-tail gates pass.
