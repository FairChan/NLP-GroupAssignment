param(
    [string]$Python = "$env:USERPROFILE\.conda\envs\toxic-nlp\python.exe",
    [switch]$SkipTraining,
    [switch]$SkipExport
)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

if (-not (Test-Path $Python)) {
    $Python = "python"
}

Write-Host "Using Python: $Python"
& $Python -c "import torch; print('cuda=', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu')"

if (-not (Test-Path "data\raw\train.csv")) {
    throw "Missing data\raw\train.csv. Download Jigsaw data before retraining."
}

if (-not $SkipTraining) {
    Write-Host "Running DistilBERT ASL gamma_neg=4.5 optimization..."
    & $Python -m src.toxic_detector.train_transformer `
        --data-path data\raw\train.csv `
        --output-dir artifacts\distilbert_asl_gn45_e4 `
        --model-name distilbert-base-uncased `
        --batch-size 8 `
        --eval-batch-size 16 `
        --gradient-accumulation-steps 2 `
        --epochs 4 `
        --loss asl `
        --gamma-neg 4.5

    Write-Host "Running DistilBERT APL optimization..."
    & $Python -m src.toxic_detector.train_transformer `
        --data-path data\raw\train.csv `
        --output-dir artifacts\distilbert_apl_e4 `
        --model-name distilbert-base-uncased `
        --batch-size 8 `
        --eval-batch-size 16 `
        --gradient-accumulation-steps 2 `
        --epochs 4 `
        --loss apl `
        --gamma-neg 4.0
}

if (-not $SkipExport) {
    Write-Host "Restoring extension model to the best safe DistilBERT artifact..."
    & $Python scripts\export_extension_model.py `
        --model-dir artifacts\distilbert_repro `
        --output-dir extension\model `
        --no-quantize

    Write-Host "Verifying DistilBERT extension ONNX parity..."
    & $Python scripts\verify_extension_model.py `
        --model-dir artifacts\distilbert_repro `
        --onnx-path extension\model\model.onnx
}

Write-Host "DistilBERT optimization entry finished. Compare artifacts\distilbert_*\metrics.json before publishing a new candidate."
