"""Compatibility entrypoint for the local FastAPI inference service.

The main application lives in model_service.app. This module exists so tools
or reviewers that look for a conventional api.py can still run:

    uvicorn api:app --host 127.0.0.1 --port 8000
"""

from model_service.app import app

__all__ = ["app"]
