# Harmful Comments and Cyberbullying Detection System

This is a multi-tag detection project for harmful English comments, including training code, a local FastAPI inference service, and an offline browser plugin for Chrome/Edge Manifest V3.

## Current Project Status

- Browser extension: implemented under `extension/` as a Manifest V3 offline Chrome/Edge extension.
- FastAPI service: implemented under `model_service/app.py`.
- Compatibility API entrypoint: `api.py`, so `uvicorn api:app --host 127.0.0.1 --port 8000` works for tools that expect a root-level API module.
- Training scripts: implemented under `src/toxic_detector/`, especially `src/toxic_detector/train_transformer.py`.
- Local training metrics: generated under `artifacts/*/metrics.json`, which is intentionally ignored by Git.
- Committed model report: see `docs/model_status.md` and `reports/distilbert_repro/metrics.json`.
- Stable extension model: current packaged model remains DistilBERT ONNX under `extension/model/`.

## Project Components

- Baseline: `TF-IDF + Logistic Regression`
- Stable deep model: `DistilBERT + Asymmetric Loss`
- Optional local API: FastAPI service with `/health` and `/predict`
- Browser extension: offline ONNX inference inside the extension, no localhost API required
- Labels: `toxic`, `severe_toxic`, `obscene`, `threat`, `insult`, `identity_hate`

## Environment

Use Python 3.11 instead of the system Python 3.13:

```powershell
conda create -n toxic-nlp python=3.11 -y
conda activate toxic-nlp
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

Verify GPU:

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## Data

Download the Jigsaw Toxic Comment Classification dataset:

```powershell
.\scripts\download_kaggle.ps1
```

Expected file:

```text
data/raw/train.csv
```

## Training

Train the classical baseline:

```powershell
python -m src.toxic_detector.train_baseline --data-path data/raw/train.csv --output-dir artifacts/baseline
```

Train DistilBERT:

```powershell
python -m src.toxic_detector.train_transformer --data-path data/raw/train.csv --output-dir artifacts/distilbert
```

Training outputs are written under the chosen `artifacts/...` directory:

- `config.json`
- `model.safetensors` or `pytorch_model.bin`
- tokenizer files
- `thresholds.json`
- `metrics.json`
- `training_config.json`

`artifacts/` is ignored by Git because these files are generated and can be large. A committed summary of the stable DistilBERT run is available in `docs/model_status.md`, with a JSON copy at `reports/distilbert_repro/metrics.json`.

## Optional FastAPI Service

Primary entrypoint:

```powershell
uvicorn model_service.app:app --host 127.0.0.1 --port 8000
```

Compatibility entrypoint:

```powershell
uvicorn api:app --host 127.0.0.1 --port 8000
```

Health check:

```powershell
curl http://127.0.0.1:8000/health
```

Prediction test:

```powershell
curl -X POST http://127.0.0.1:8000/predict `
  -H "Content-Type: application/json" `
  -d '{"texts":["You are stupid and I hate you."],"threshold_profile":"balanced"}'
```

## Browser Extension

The current extension performs offline inference in the browser extension itself. It does not require the FastAPI service.

Load it in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `C:\Users\ssema\Desktop\nlpga\extension`.
5. Refresh the target social-media page.

Packaged zip:

```text
dist/offline-toxic-comment-shield-0.3.2.zip
```

## Evaluation

The training script reports:

- per-label Precision / Recall / F1 / ROC-AUC
- Macro F1
- Micro F1
- Hamming Loss
- optimized per-label thresholds

Stable DistilBERT reference result:

```text
Macro F1: 0.728471
Micro F1: 0.809577
Mean ROC-AUC: 0.993373
Hamming Loss: 0.014205
```

## High-Performance Retraining

For teacher/student experiments:

```powershell
.\scripts\train_high_performance.ps1
```

This trains stronger teacher candidates and distills lighter student candidates. Do not replace `extension/model` unless the generated release gate passes accuracy, long-tail, size, and latency checks.
