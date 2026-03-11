# ──────────────────────────────────────────────────────────────────────────────
# Dockerfile for the dbRIP API
# ──────────────────────────────────────────────────────────────────────────────
#
# This builds a self-contained image that:
#   1. Installs Python dependencies
#   2. Copies the source code and data
#   3. Runs the ingest pipeline to load the CSV into SQLite
#   4. Starts the FastAPI server
#
# The database (SQLite) is baked into the image — no external database needed.
# This is the simplest deployment option. For PostgreSQL, use docker-compose.yml.
#
# BUILD:
#   docker build -t dbrip-api .
#
# RUN:
#   docker run -p 8000:8000 dbrip-api
#
# THEN:
#   open http://localhost:8000/docs
# ──────────────────────────────────────────────────────────────────────────────

FROM python:3.13-slim

# Don't write .pyc files, don't buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first (cached layer — only re-runs when pyproject.toml changes)
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Copy source code and data
COPY app/ app/
COPY ingest/ ingest/
COPY scripts/ scripts/
COPY data/ data/

# Load the CSV into SQLite at build time
# This means the database is baked into the image — no setup needed at runtime
RUN python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# Expose the API port
EXPOSE 8000

# Start the server
# --host 0.0.0.0 makes it accessible from outside the container
# --workers 4 uses multiple processes for handling concurrent requests
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
