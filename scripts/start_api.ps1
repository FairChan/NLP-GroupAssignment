param(
  [string]$ModelDir = "artifacts/distilbert",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$env:TOXIC_MODEL_DIR = $ModelDir
uvicorn model_service.app:app --host 127.0.0.1 --port $Port
