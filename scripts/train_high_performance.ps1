param(
    [string]$Python = "$env:USERPROFILE\.conda\envs\toxic-nlp\python.exe",
    [switch]$SkipTeachers,
    [switch]$SkipStudent,
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

Write-Host "Reproducing current DistilBERT baseline metrics..."
& $Python -m src.toxic_detector.train_transformer `
    --data-path data\raw\train.csv `
    --output-dir artifacts\distilbert_repro `
    --model-name distilbert-base-uncased `
    --batch-size 8 `
    --eval-batch-size 16 `
    --gradient-accumulation-steps 2 `
    --epochs 3 `
    --loss asl

if (-not $SkipTeachers) {
    Write-Host "Training ModernBERT teacher experiments..."
    & $Python -m src.toxic_detector.train_teacher --config configs\teacher_modernbert.json

    Write-Host "Training DeBERTa-v3 teacher experiments..."
    & $Python -m src.toxic_detector.train_teacher --config configs\teacher_deberta_v3.json
}

if (-not $SkipStudent) {
    if (-not $SkipTeachers) {
        Write-Host "Selecting best teacher checkpoint..."
        & $Python scripts\select_best_teacher.py `
            --reports artifacts\teacher_modernbert\teacher_experiments.json artifacts\teacher_deberta_v3\teacher_experiments.json `
            --output-dir artifacts\teacher_best
    }

    Write-Host "Distilling MiniLM student from selected teacher..."
    & $Python -m src.toxic_detector.distill_student --config configs\student_minilm_distill.json
}

if (-not $SkipExport) {
    Write-Host "Exporting and quantizing extension model..."
    & $Python scripts\export_extension_model.py --config configs\export_int8.json

    Write-Host "Benchmarking extension model..."
    & $Python scripts\benchmark_extension_model.py --config configs\export_int8.json
}

Write-Host "High-performance retraining pipeline finished. Check artifacts\model_cards\retrain_report.md and release_gate.json before replacing the extension model."
