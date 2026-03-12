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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import datasets, export, insertions, stats

# ── Create the app ───────────────────────────────────────────────────────

app = FastAPI(
    title="dbRIP API",
    description="Read-only API for the dbRIP database of retrotransposon insertion polymorphisms.",
    version="0.1.0",
)

# ── Middleware ────────────────────────────────────────────────────────────

# Allow requests from any origin (suitable for a public read-only API).
# If you want to restrict this later, replace ["*"] with specific domains.
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
