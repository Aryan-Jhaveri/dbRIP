# dbRIP API

Read-only database of 44,984 retrotransposon insertion polymorphisms across 33 populations from the 1000 Genomes Project. Provided as a web app, REST API, and command-line tool.

Currently hosting on : https://dbrip-api.onrender.com/ {Mar-12/2025 | API works from there too}

---

## CLI — query the database from your terminal

Most lab members only need this. Install the CLI directly from GitHub — no cloning required:

```bash
pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"
```

This installs the `dbrip` command and its two dependencies (`typer`, `httpx`). Nothing else from the repo is installed.

Then tell it where the hosted server is:

```bash
export DBRIP_API_URL=https://<your-deploy-url>
```

You can add that line to your `~/.bashrc` or `~/.zshrc` so you don't have to set it every session.

```bash
# Search by region and TE type
dbrip search --region chr1:1M-5M --me-type ALU

# Get full details for one insertion
dbrip get A0000001

# Export to BED/VCF/CSV
dbrip export --format bed --me-type LINE1 -o line1.bed
dbrip export --format vcf | bgzip > insertions.vcf.gz

# Summary counts
dbrip stats --by me_type
dbrip stats --by population
```

Add `--output json` to any command for pipe-friendly JSON instead of a table.

---

## Web App

The web app is served from the same URL as the API. It has six tabs:

- **Interactive Search** — search and filter all insertions, expand rows for population frequencies, copy selected rows as TSV, view in IGV
- **File Search** — upload a BED/CSV/TSV and find overlapping insertions within a configurable window
- **Batch Search** — filter by TE type, category, annotation, strand, and chromosome
- **IGV Viewer** — embedded genome browser; navigates automatically from Interactive Search
- **API Reference** — full endpoint documentation
- **CLI Reference** — quick-reference for all `dbrip` commands

---

## Self-hosting

If you want to run your own instance (e.g. on a lab server), the simplest path is Docker:

```bash
git clone https://github.com/Aryan-Jhaveri/dbRIP.git
cd dbRIP
docker build -t dbrip-api .
docker run -p 8000:8000 dbrip-api
```

Open `http://localhost:8000`. The image builds the frontend, loads the database, and starts the server in one step.

For cloud hosting, connect the repo to [Render](https://render.com) — it will detect the `render.yaml` and configure everything automatically. Every push to `main` triggers a redeploy.

---

## Development

For working on the code locally. Requires Python 3.11+ and Node.js 18+.

```bash
# Python setup
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[all,dev]"
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
uvicorn app.main:app --reload   # → http://localhost:8000/docs

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # → http://localhost:5173

# Tests
pytest tests/ -v
```

### Project structure

```
data/raw/dbRIP_all.csv          ← source CSV (44,984 rows); the DB is always rebuildable from this
data/manifests/dbrip_v1.yaml   ← describes the CSV format for the ingest pipeline

ingest/                         ← ETL pipeline
scripts/ingest.py               ← CLI to load CSV into SQLite

app/                            ← FastAPI (read-only)
cli/dbrip.py                    ← `dbrip` CLI (Typer + httpx)
frontend/src/                   ← React app (Vite + TanStack + Tailwind + igv.js)
tests/                          ← pytest suite (60 tests)
```

### API endpoints

Full interactive docs at `/docs`. Quick reference:

| Endpoint | Description |
|----------|-------------|
| `GET /v1/insertions` | List/search insertions |
| `GET /v1/insertions/{id}` | Single insertion with population frequencies |
| `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}` | Region query |
| `GET /v1/export?format=bed\|vcf\|csv` | Export filtered results |
| `GET /v1/stats?by=me_type\|chrom\|variant_class` | Summary counts |

Common filter parameters: `me_type`, `me_subtype`, `me_category`, `variant_class`, `annotation`, `population`, `min_freq`, `max_freq`, `limit`, `offset`.
