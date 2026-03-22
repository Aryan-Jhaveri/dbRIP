# Deployment

## Architecture overview

```
GitHub (main branch)
  |
  |-- push data/raw/*.csv or frontend/src/**
  |     -> build-trackhub.yml
  |       -> ingest -> API -> build_trackhub.py -> bigBed files
  |       -> npm run build -> frontend/dist
  |       -> deploy both to gh-pages branch
  |
  |-- push app/** or tests/**
  |     -> docker.yml
  |       -> pytest -> Docker build -> ghcr.io
  |
  +-- gh-pages branch
        /          -> React frontend (GitHub Pages)
        /hub/      -> UCSC Track Hub files (GitHub Pages)

Render (or your lab server)
  +-- FastAPI backend (auto-deploys from main, or manual)
```

Three components, three hosts:

| Component | Host | Why |
|-----------|------|-----|
| React frontend | GitHub Pages (`/`) | Free, fast, no cold-start |
| Track hub files | GitHub Pages (`/hub/`) | Same host; reliable HTTPS; UCSC needs byte-range support |
| FastAPI backend | Render, lab server, or cloud VM | Needs a running Python process |

---

## CI/CD workflows

### Workflow 1: `build-trackhub.yml`

Builds the track hub and frontend, deploys both to GitHub Pages.

**Triggers:**
- Push to `main` with changes to `data/raw/dbRIP_all.csv`, `frontend/src/**`, `frontend/package.json`, or `data/hub/templates/`
- Manual trigger from GitHub UI

**Steps:**
1. Checkout + setup Python 3.13
2. `pip install -e ".[all]"`
3. Download UCSC static binaries (bedToBigBed, fetchChromSizes)
4. `python scripts/ingest.py` (build SQLite)
5. `uvicorn app.main:app &` (background, health-check loop)
6. `python scripts/build_trackhub.py` (API -> bigBed files + config)
7. Setup Node 20 + `npm ci`
8. `VITE_API_URL=... npm run build` (bake API URL into frontend JS)
9. Deploy `frontend/dist` -> gh-pages `/` (with `keep_files: true`)
10. Deploy `hub/` -> gh-pages `/hub/` (with `keep_files: true`)

The two deploy steps both use `keep_files: true` to prevent each from deleting the other.

The CI workflow only triggers on changes to data, frontend, hub templates, and the workflow file itself. If you change Python backend files (`app/`, `ingest/`), the Render/server deployment updates automatically. To rebuild the frontend after a backend change, trigger the workflow manually.

### Workflow 2: `docker.yml`

Runs tests and builds a Docker image.

**Triggers:** Push to `main` with changes to backend or test files.

**Steps:**
1. Checkout + setup Python
2. Install dev dependencies
3. Run pytest
4. Build Docker image
5. Push to GitHub Container Registry (ghcr.io)

---

## GitHub Pages URLs

After deployment:

```
Frontend:  https://<owner>.github.io/<repo>/
Track hub: https://<owner>.github.io/<repo>/hub/hub.txt
UCSC load: https://genome.ucsc.edu/cgi-bin/hgTracks?hubUrl=https://<owner>.github.io/<repo>/hub/hub.txt
```

The hub URL is built dynamically from `github.repository_owner` and `github.event.repository.name`, so it updates automatically when the repo is forked.

---

## Forking the repo

When the lab forks this repo:

1. GitHub Pages URLs update automatically (`<owner>.github.io/<repo>`)
2. Hub URL updates automatically (constructed from repo metadata in CI)
3. The one thing to change: `API_BASE_URL` in `.github/workflows/build-trackhub.yml` if the API moves to a different host

```yaml
env:
  API_BASE_URL: https://your-server.university.edu/v1   # change this
```

Push any file to `main` or manually trigger the workflow to rebuild with the new URL.

---

## Running the API

### On a new machine

```bash
git clone https://github.com/<your-org>/<repo>.git
cd <repo>
python -m venv .venv
source .venv/bin/activate
pip install -e ".[api,ingest]"
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

For production, run behind nginx or as a systemd service.

### On Render

Connect the repo to [Render](https://render.com). It detects `render.yaml` and creates the service automatically. Auto-deploys on push to `main`.

Free-tier Render instances sleep after inactivity. The first request after waking takes ~30 seconds. The frontend shows a loading state during this.

### Docker

```bash
docker build -t dbrip-api .
docker run -p 8000:8000 dbrip-api
```

The image builds the frontend, loads the database, and starts the server.

---

## CORS

The API uses `allow_origins=["*"]` because it is read-only and public. The frontend on GitHub Pages and the API on Render are on different origins, so CORS must be permissive. Only GET and POST (for file upload) are allowed.

---

## Frontend API URL

| Environment | How `BASE` is set |
|-------------|------------------|
| Local dev | Falls back to `/v1`. Vite dev server proxies requests to localhost:8000. |
| GitHub Pages | `VITE_API_URL` env var is set at build time in CI. Baked into the compiled JS. |
| Same server as API | Falls back to `/v1`. Relative URL resolves to the same origin. |

If a developer runs `npm run build` without setting `VITE_API_URL`, `BASE` falls back to `/v1`. This is fine for local dev but the GitHub Pages build will call the wrong URL.
