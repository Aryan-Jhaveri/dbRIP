# dbRIP API

The [dbRIP database](https://lianglab.shinyapps.io/shinydbRIP/) (Liang Lab, Brock University) currently catalogs 44,984 transposable element insertion polymorphisms — positions in the human genome where a mobile element (ALU, LINE1, SVA, HERVK) is present in some people but absent in others. Each insertion carries allele frequencies across 33 populations from the 1000 Genomes Project (hg38).

This repo turns that dataset into a queryable, self-updating system with direct UCSC Genome Browser integration:

- **UCSC Genome Browser track hub** — A GitHub Actions workflow converts the database into indexed bigBed files (one per ME family) and deploys them to GitHub Pages. UCSC loads insertions as colored, searchable tracks, fetching only the visible region via HTTP byte-range — no data upload to UCSC, no manual rebuild step. Pushing a new CSV to `main` is all it takes to update the hub.
- **Data updates are a single command** — The CSV in `data/raw/` is the source of truth; the database is always rebuildable from it. Adding a batch of new entries or correcting existing ones means dropping in an updated CSV and running `python scripts/ingest.py`. The API, frontend, and track hub all reflect the change after the next push to `main`.
- **Multiple access modes** — Read-only REST API (JSON, BED6, VCF, CSV), a six-tab React web app with population frequency tables and bulk IGV/UCSC export, a `dbrip` CLI installable directly from GitHub, and a Claude MCP connector for natural-language queries.
- **Fork-and-run deployment** — GitHub Pages hosts the frontend and track hub automatically on any fork. The one thing to configure: `API_BASE_URL` in `.github/workflows/build-trackhub.yml`, pointing at wherever the lab runs the FastAPI backend (lab server, cloud VM, or free-tier host).

| Service | URL |
|---------|-----|
| API + Web App | https://dbrip-api.onrender.com |
| Frontend (GitHub Pages) | https://aryan-jhaveri.github.io/dbRIP/ |
| UCSC Track Hub | [Load in UCSC](https://genome.ucsc.edu/cgi-bin/hgTracks?hubUrl=https://aryan-jhaveri.github.io/dbRIP/hub/hub.txt) |

> **Note:** When the lab forks this repo, the GitHub Pages URLs update automatically (the CI workflow builds them from the repo owner/name). The API URL is set via `API_BASE_URL` in `.github/workflows/build-trackhub.yml` — update it to wherever the lab is hosting the FastAPI backend.

---

## Components

| Component | What it is | How to get it |
|-----------|-----------|---------------|
| **CLI** | `dbrip` terminal tool — search, export, stats | `pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"` |
| **MCP** | Claude connector — query the DB in natural language | Claude Desktop config (no install) |
| **API** | FastAPI backend + REST endpoints | `pip install "dbrip-api[api] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"` |
| **Frontend** | React web app (6 tabs, IGV viewer) | Served by the API or via GitHub Pages |
| **Track Hub** | UCSC Genome Browser integration — bigBed tracks per ME family | Built by CI, hosted on GitHub Pages |
| **Full stack** | Everything above, one container | `docker run` or Render blueprint |

---

## UCSC Track Hub

The track hub lets any researcher load dbRIP insertions directly in the UCSC Genome Browser — colored by ME family (ALU red, LINE1 blue, SVA green), searchable by dbRIP ID.

**Load the hub:**
My Data → Track Hubs → My Hubs → paste:
```
https://aryan-jhaveri.github.io/dbRIP/hub/hub.txt
```

**How it works:**
- CI exports BED6 per ME type from the API → sorts → converts to bigBed (indexed binary)
- UCSC fetches only the visible region via HTTP byte-range requests — no full download
- The hub rebuilds automatically when `data/raw/dbRIP_all.csv` is pushed to `main`

> **Known data issue:** 132 rows in the source CSV have `End < Start` (coordinates appear swapped). These rows are present and queryable in the API and frontend but are excluded from the track hub, which requires `end > start`. See GUIDE.md §4 for the full breakdown and how to fix them in the CSV.


**Architecture:**
```
CSV (source of truth)
  → scripts/ingest.py → SQLite
  → uvicorn (local API in CI)
  → scripts/build_trackhub.py
    → GET /v1/export?format=bed&me_type=ALU
    → sort -k1,1 -k2,2n
    → bedToBigBed → .bb files
  → GitHub Pages /hub/
  → UCSC loads hub.txt → fetches .bb byte ranges
```

---

## CLI

Most lab members only need this. No cloning required — installs straight from GitHub.

**1. Install**
```bash
pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"
```

**2. Point it at a server**
```bash
# Use the hosted instance (no local setup needed):
export DBRIP_API_URL=https://dbrip-api.onrender.com

# Or a local instance if you're running the API yourself:
export DBRIP_API_URL=http://localhost:8000
```

Add the `export` line to `~/.bashrc` or `~/.zshrc` to make it permanent.

**3. Use it**
```bash
dbrip datasets                                    # check connection
dbrip search --region chr1:1M-5M --me-type ALU    # region + filter
dbrip get A0000001                                # full record
dbrip export --format bed --me-type LINE1 -o l1.bed
dbrip stats --by me_type
```

---

## MCP (Claude connector)

Query the database in natural language from Claude Desktop.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dbrip": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3001/mcp"]
    }
  }
}
```

The MCP server must be running locally (`cd mcp && npm start`) — or replace `localhost:3001` with the hosted MCP URL to skip local setup.

| Tool | What it does |
|------|-------------|
| `list_datasets` | Confirm the database is loaded and get row counts |
| `get_stats` | Counts grouped by TE family, chromosome, variant class, etc. |
| `list_insertions` | Free-text search + filters across the full database |
| `search_by_region` | Find insertions overlapping a genomic region |
| `get_insertion` | Full record including all 33 population frequencies |

---

## Web App

Six tabs:

- **Interactive Search** — search and filter all insertions, expand rows for population frequencies, copy selected rows as TSV, view in IGV
- **File Search** — upload a BED/CSV/TSV and find overlapping insertions within a configurable window
- **Batch Search** — filter by TE type, category, annotation, strand, and chromosome
- **IGV Viewer** — embedded genome browser; navigates automatically from Interactive Search
- **API Reference** — full endpoint documentation
- **CLI Reference** — quick-reference for all `dbrip` commands

---

## Self-hosting

```bash
git clone https://github.com/Aryan-Jhaveri/dbRIP.git
cd dbRIP
docker build -t dbrip-api .
docker run -p 8000:8000 dbrip-api
```

Open `http://localhost:8000`. The image builds the frontend, loads the database, and starts the server in one step.

For cloud hosting, connect the repo to [Render](https://render.com) → New → Blueprint. It detects `render.yaml` and creates both services automatically.

---

## Development

Requires Python 3.11+ and Node.js 20+.

```bash
# Python setup
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[all,dev]"
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
uvicorn app.main:app --reload          # → http://localhost:8000/docs

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # → http://localhost:5173

# MCP server (separate terminal)
cd mcp && npm install && npm start         # → http://localhost:3001/mcp

# Tests
pytest tests/ -v                           # 101 tests
```

### Project structure

```
data/raw/dbRIP_all.csv          ← source CSV (44,984 rows); DB is always rebuildable from this
data/manifests/dbrip_v1.yaml   ← describes the CSV format for the ingest pipeline
data/hub/templates/            ← UCSC track hub config templates

ingest/                         ← ETL pipeline (BaseLoader + dbRIP-specific loader)
scripts/ingest.py               ← CLI to load CSV into SQLite
scripts/build_trackhub.py       ← CLI to build bigBed files + hub config from the API

app/                            ← FastAPI backend (read-only, 7 endpoints)
cli/dbrip.py                    ← CLI (Typer + httpx, talks to hosted API)
frontend/src/                   ← Frontend (Vite + React + TanStack + Tailwind + igv.js)
mcp/                            ← MCP server (Express + @modelcontextprotocol/sdk)
tests/                          ← pytest suite (101 tests)

.github/workflows/
  docker.yml                    ← CI: test + Docker build → ghcr.io
  build-trackhub.yml            ← CI: build hub + frontend → GitHub Pages
```

### Deployment architecture

```
GitHub (main branch)
  │
  ├─ push data/raw/*.csv or frontend/src/**
  │     → build-trackhub.yml
  │       → ingest → API → build_trackhub.py → bigBed files
  │       → npm run build → frontend/dist
  │       → deploy both to gh-pages branch
  │
  ├─ push app/** or tests/**
  │     → docker.yml
  │       → pytest → Docker build → ghcr.io
  │
  └─ gh-pages branch
        /          → React frontend (GitHub Pages)
        /hub/      → UCSC Track Hub files (GitHub Pages)

Render
  └─ dbrip-api    → FastAPI backend (auto-deploys from main)
```

### API endpoints

Full interactive docs at `/docs`. Quick reference:

| Endpoint | Description |
|----------|-------------|
| `GET /v1/insertions` | List/search insertions |
| `GET /v1/insertions/{id}` | Single insertion with population frequencies |
| `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}` | Region query |
| `POST /v1/insertions/file-search` | Upload BED/CSV/TSV, find overlapping insertions |
| `GET /v1/export?format=bed\|vcf\|csv` | Export filtered results |
| `GET /v1/stats?by=me_type\|chrom\|variant_class` | Summary counts |
| `GET /v1/datasets` | Loaded dataset registry |

Common filter parameters: `me_type`, `me_subtype`, `me_category`, `variant_class`, `annotation`, `population`, `min_freq`, `max_freq`, `strand`, `chrom`, `search`, `limit`, `offset`
