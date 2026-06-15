param(
  [string]$DataPath = "data/raw/train.csv"
)

$ErrorActionPreference = "Stop"

python -m src.toxic_detector.train_baseline --data-path $DataPath --output-dir artifacts/baseline
python -m src.toxic_detector.train_transformer --data-path $DataPath --output-dir artifacts/distilbert
