# Getting Started

## Taking over this project

If you are a new lab member inheriting this project, read this section first. Everything else in the wiki is reference material.

### What GitHub handles automatically

Every push to `main` triggers a CI workflow (`.github/workflows/build-trackhub.yml`) that:

1. Rebuilds the SQLite database from the CSV
2. Builds the React frontend
3. Generates bigBed files for the UCSC track hub
4. Deploys both the frontend and hub to GitHub Pages

You never run these steps manually. Push code, GitHub does the rest. The deployed URLs are:

```
Frontend:  https://<owner>.github.io/<repo>/
Track hub: https://<owner>.github.io/<repo>/hub/hub.txt
```

### What you run yourself

The FastAPI backend (the Python server that answers data queries) must run on a machine your lab controls. GitHub Pages only serves static files.

| Option | Notes |
|--------|-------|
| Lab server or university VM | Most stable for long-term hosting |
| Cloud VM (AWS, GCP, Azure) | Good if no in-house server is available |
| Render / Railway / Fly.io | Fine for demos; free tiers may sleep after inactivity |
| Your laptop | Development only |

### The one thing you must update

Open `.github/workflows/build-trackhub.yml` and set `API_BASE_URL` to the public URL of wherever you host the API:

```yaml
env:
  API_BASE_URL: https://your-server.university.edu/v1   # change this
```

Push any file to `main` or go to Actions > "Build Track Hub + Frontend" > Run workflow to trigger a rebuild. The new URL gets baked into the compiled frontend JS at build time.

### How to run the API on a new machine

```bash
# 1. Clone the repo
git clone https://github.com/<your-org>/<repo>.git
cd <repo>

# 2. Create a virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -e ".[api,ingest]"

# 3. Load the CSV into SQLite (must be done before starting the server)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# 4. Start the API server
#    --host 0.0.0.0 makes it reachable from other machines on the network.
#    For production, run behind nginx or a systemd service.
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API is now live at `http://your-server:8000`. Point `API_BASE_URL` at it.

---

## Quick start (development)

```bash
# Activate the virtual environment
source .venv/bin/activate

# Install dependencies (first time only)
pip install -e ".[dev]"

# Load the CSV into SQLite
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# Start the API server
uvicorn app.main:app --reload
# API is now at http://localhost:8000
# Interactive docs at http://localhost:8000/docs

# Run tests
pytest tests/ -v

# Start the frontend (separate terminal)
cd frontend && npm run dev
```

### Useful commands

| Task | Command |
|------|---------|
| Run tests | `pytest tests/ -v` |
| Dry run (validate CSV, no DB write) | `python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run` |
| Load data | `python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml` |
| Frontend dev server | `cd frontend && npm run dev` |
| Frontend type-check | `cd frontend && npx tsc --noEmit` |
| Build trackhub (dry run) | `python scripts/build_trackhub.py --api-url http://localhost:8000 --hub-url https://aryan-jhaveri.github.io/dbRIP/hub --dry-run` |
| Build trackhub (full) | `python scripts/build_trackhub.py --api-url http://localhost:8000 --hub-url https://aryan-jhaveri.github.io/dbRIP/hub` |
| Check hub currency | `python scripts/build_trackhub.py --status` |

### Requirements

- Python 3.11+
- Node.js 20+
- For full track hub builds: `bedToBigBed` and `fetchChromSizes` (see [Track Hub](track-hub.md))
