from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from model_service.predictor import ToxicityPredictor
from model_service.schemas import HealthResponse, PredictRequest, PredictResponse
from src.toxic_detector.config import LABELS

MODEL_DIR = Path(os.getenv("TOXIC_MODEL_DIR", "artifacts/distilbert"))
PREDICTOR = ToxicityPredictor(
    model_dir=MODEL_DIR,
    device=os.getenv("TOXIC_DEVICE", "auto"),
    batch_size=int(os.getenv("TOXIC_BATCH_SIZE", "16")),
)
LOAD_ERROR: str | None = None

app = FastAPI(
    title="Toxic Comment Detection API",
    version="0.1.0",
    description="Local inference service for multi-label toxic comment detection.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def load_model() -> None:
    global LOAD_ERROR
    try:
        PREDICTOR.load()
        LOAD_ERROR = None
    except Exception as exc:
        LOAD_ERROR = str(exc)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok" if PREDICTOR.loaded else f"model_unavailable: {LOAD_ERROR}",
        model_loaded=PREDICTOR.loaded,
        model_dir=str(MODEL_DIR),
        labels=LABELS,
        device=None if PREDICTOR.device is None else str(PREDICTOR.device),
    )


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    if not PREDICTOR.loaded:
        raise HTTPException(
            status_code=503,
            detail=f"Model is not loaded. Train the model or set TOXIC_MODEL_DIR. Last error: {LOAD_ERROR}",
        )
    return PredictResponse(
        model_loaded=True,
        threshold_profile=request.threshold_profile,
        results=PREDICTOR.predict(request.texts),
    )
