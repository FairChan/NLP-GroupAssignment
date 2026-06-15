param(
  [string]$Competition = "jigsaw-toxic-comment-classification-challenge",
  [string]$OutputDir = "data/raw"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not (Get-Command kaggle -ErrorAction SilentlyContinue)) {
  throw "Kaggle CLI not found. Activate the toxic-nlp environment and run: pip install kaggle"
}

kaggle competitions download -c $Competition -p $OutputDir

Get-ChildItem -Path $OutputDir -Filter "*.zip" | ForEach-Object {
  Expand-Archive -LiteralPath $_.FullName -DestinationPath $OutputDir -Force
}

Get-ChildItem -Path $OutputDir -Filter "*.zip" | ForEach-Object {
  if ($_.Name -ne "$Competition.zip") {
    Expand-Archive -LiteralPath $_.FullName -DestinationPath $OutputDir -Force
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $OutputDir "train.csv"))) {
  throw "train.csv was not found after extraction. Check Kaggle download permissions and archive contents."
}

Write-Host "Dataset ready at $OutputDir"
