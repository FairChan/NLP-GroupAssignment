param(
    [string]$Python = "$env:USERPROFILE\.conda\envs\toxic-nlp\python.exe",
    [string]$CorpusPath = "artifacts\combined_stable_corpus.csv",
    [string]$CorpusSummaryPath = "artifacts\model_cards\combined_stable_corpus_summary.json",
    [string]$OutputDir = "artifacts\distilbert_stable_combined",
    [string]$TensorBoardLogDir = "logs\tensorboard\distilbert_stable_combined",
    [int]$MaxRowsPerSource = 50000,
    [double]$MaxNegativeRatio = 4.0,
    [int]$Epochs = 3,
    [double]$LearningRate = 0.00002,
    [string]$InitModelDir = "",
    [switch]$SkipCorpus,
    [switch]$LaunchTensorBoard
)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
$env:KMP_DUPLICATE_LIB_OK = "TRUE"

if (-not (Test-Path $Python)) {
    $Python = "python"
}

Write-Host "Using Python: $Python"
& $Python -c "import torch; print('cuda=', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu')"

if (-not $SkipCorpus) {
    Write-Host "Preparing combined stable corpus..."
    & $Python scripts\prepare_combined_corpus.py `
        --output $CorpusPath `
        --summary-output $CorpusSummaryPath `
        --max-rows-per-source $MaxRowsPerSource `
        --max-negative-ratio $MaxNegativeRatio
}

if ($LaunchTensorBoard) {
    Write-Host "Starting TensorBoard at http://127.0.0.1:6006 ..."
    Start-Process -WindowStyle Hidden -FilePath $Python -ArgumentList @(
        "-m", "tensorboard.main",
        "--logdir", $TensorBoardLogDir,
        "--host", "127.0.0.1",
        "--port", "6006"
    )
}

$trainArgs = @(
    "-m", "src.toxic_detector.train_transformer",
    "--data-path", $CorpusPath,
    "--output-dir", $OutputDir,
    "--model-name", "distilbert-base-uncased",
    "--batch-size", "8",
    "--eval-batch-size", "16",
    "--gradient-accumulation-steps", "2",
    "--epochs", "$Epochs",
    "--lr", "$LearningRate",
    "--loss", "asl",
    "--gamma-neg", "4.0",
    "--tensorboard-logdir", $TensorBoardLogDir
)

if ($InitModelDir -and (Test-Path $InitModelDir)) {
    Write-Host "Continuing from stable checkpoint: $InitModelDir"
    $trainArgs += @("--init-model-dir", $InitModelDir)
}

Write-Host "Training stable DistilBERT candidate..."
& $Python @trainArgs

Write-Host "Training complete. TensorBoard logdir: $TensorBoardLogDir"
Write-Host "Open http://127.0.0.1:6006 if TensorBoard is running."
