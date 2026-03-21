"""
FastAPI application — the main entry point for the API server.

This file creates the FastAPI app and registers all the routers (endpoints).
It's the "front door" — everything starts here.

HOW TO RUN:
    uvicorn app.main:app --reload

    Then open http://localhost:8000/docs for interactive API documentation.
    FastAPI generates this automatically from your endpoint definitions.

HOW IT CONNECTS TO THE REST OF THE PROJECT:
    - app/database.py provides the database connection
    - app/models.py defines the ORM classes (but this file doesn't import them directly)
    - app/routers/*.py contain the actual endpoint logic
    - This file just wires the routers together and adds middleware

WHAT IS MIDDLEWARE?
    Middleware is code that runs on EVERY request, before and after the
    endpoint function. CORSMiddleware is needed so that web browsers can
    make requests to this API from a different domain (e.g. a React frontend
    hosted on a different URL).
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import datasets, export, insertions, stats

# ── Create the app ───────────────────────────────────────────────────────

app = FastAPI(
    title="dbRIP API",
    description="Read-only API for the dbRIP database of retrotransposon insertion polymorphisms.",
    version="0.1.0",
)

# ── Middleware ────────────────────────────────────────────────────────────

# Allow requests from any origin (suitable for a public read-only API).
#
# WHY ["*"]?
#   The API is read-only and intentionally public — any researcher should be
#   able to query it from any tool or website. Restricting by origin would
#   block legitimate use without any security benefit.
#
# KNOWN PRODUCTION CONSUMERS:
#   - GitHub Pages frontend: https://aryan-jhaveri.github.io/dbRIP/
#     (when the lab forks the repo the domain will change, but ["*"] keeps
#     working without needing an update here)
#   - UCSC Track Hub: the browser fetches bigBed files directly from GitHub
#     Pages, not from this API — so CORS on the hub files is Pages' concern
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # GET for all read endpoints; POST for file-search (multipart upload).
    # The API is still read-only — POST is only used to accept file input,
    # not to create or modify any data in the database.
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Register routers ─────────────────────────────────────────────────────

# Each router handles a group of related endpoints.
# The prefix is already set in each router file (e.g. prefix="/v1").
app.include_router(insertions.router)
app.include_router(stats.router)
app.include_router(datasets.router)
app.include_router(export.router)


# ── Health check ─────────────────────────────────────────────────────────

@app.get("/v1/health")
def health():
    """Simple health check — returns {"status": "ok"} if the server is running.

    Useful for monitoring and container health checks (e.g. Docker HEALTHCHECK).
    """
    return {"status": "ok"}


# ── Static frontend (production / Docker only) ────────────────────────────
#
# In production, the React app is compiled to a set of static HTML/JS/CSS files
# by `npm run build` (see the Dockerfile). FastAPI serves them here.
#
# WHY AT THE BOTTOM?
#   FastAPI processes route registrations in order. By mounting StaticFiles last,
#   we guarantee that all /v1/* API routes take priority. StaticFiles acts as a
#   catch-all: any request that doesn't match an API route (e.g. /, /search,
#   /batch) is served index.html, which lets React Router handle navigation.
#
# WHY THE EXISTS CHECK?
#   In local development (npm run dev + uvicorn --reload), app/static/ doesn't
#   exist — the frontend runs on its own dev server (port 5173) and proxies /v1/*
#   requests to FastAPI. The check prevents a startup crash during development.
_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    # html=True tells StaticFiles to serve index.html for any path it can't find,
    # which is the standard behaviour needed for single-page apps (React Router).
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="frontend")
