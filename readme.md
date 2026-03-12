# dbRIP API

Read-only REST API for the [dbRIP database](https://lianglab.shinyapps.io/shinydbRIP/) of retrotransposon insertion polymorphisms — 44,984 TE insertions across 33 populations from the 1000 Genomes Project.

## Quick Start
1. Installation

We use optional dependencies to keep the installation lean. Choose the one that fits your task:
| If you want to...	| Run this command |
| ------------------|----------------|
| Develop/Test everything	| ` pip install -e ".[all,dev]" ` |
| Just run the API server	| ` pip install -e ".[api]" ` |
| Just run the Ingest scripts	| ` pip install -e ".[ingest]" ` |
| Use the CLI tool | ` pip install -e ".[cli]" ` |


```bash
# 1. Set up Python environment
python3 -m venv .venv
source .venv/bin/activate

# Installing what we need, here we're doing all to show how
# the pipe works for developing everything
pip install -e ".[all,dev]"

# 2. Load the data into SQLite
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# 3. Start the API
uvicorn app.main:app --reload

# 4. Open the interactive docs
open http://localhost:8000/docs
```

## Web Frontend

React SPA for exploring the database in a browser. Five tabs: Interactive Search, File Search,
Batch Search, API Reference, CLI Reference.

**Stack:** Vite + React 19 + TypeScript + TanStack Table 8 + TanStack Query 5 + Tailwind CSS v4

```bash
cd frontend
npm install
npm run dev   # → http://localhost:5173
```

Vite proxies all `/v1` requests to `localhost:8000`, so the frontend and API run on separate
ports during development with no CORS configuration needed.

See [`frontend/README.md`](frontend/README.md) for architecture details and file structure.

## CLI Tool

`dbrip` — a command-line client that wraps the API. Requires the API running at
`http://localhost:8000` (or `DBRIP_API_URL` env var).

```bash
pip install -e ".[cli]"
```

| Command | What it does | Example |
|---------|--------------|---------|
| `search` | List insertions with filters | `dbrip search --region chr1:1M-5M --me-type ALU` |
| `get` | Full detail for one insertion | `dbrip get A0000001` |
| `export` | Export as BED / VCF / CSV | `dbrip export --format vcf --me-type LINE1 -o l1.vcf` |
| `stats` | Summary counts grouped by field | `dbrip stats --by me_type` |
| `datasets` | List loaded datasets | `dbrip datasets` |

Output defaults to a rich table; add `--output json` for pipe-friendly JSON.

## Project Structure

```
dbRIP-API/
│
├── data/
│   ├── raw/dbRIP_all.csv              ← Source CSV (44,984 rows, 47 columns)
│   └── manifests/dbrip_v1.yaml        ← Describes the CSV format for the ingest pipeline
│
├── ingest/                            ← ETL pipeline (used by scripts/, NOT by app/)
│   ├── base.py                        ← Abstract BaseLoader — the contract every loader follows
│   └── dbrip.py                       ← dbRIP-specific loader (reads CSV, renames cols, melts pops)
│
├── scripts/                           ← Standalone scripts for data management
│   └── ingest.py                      ← Load CSV into SQLite (run directly, not imported by API)
│
├── app/                               ← FastAPI — read-only query layer
│   ├── main.py                        ← App entry point, registers routers
│   ├── database.py                    ← SQLAlchemy engine + session (SQLite dev / PostgreSQL prod)
│   ├── models.py                      ← ORM models (Insertion, PopFrequency, DatasetRegistry)
│   ├── schemas.py                     ← Pydantic response schemas
│   └── routers/
│       ├── insertions.py              ← Search, get by ID, region queries
│       ├── export.py                  ← BED / VCF / CSV export
│       ├── stats.py                   ← Summary counts (GROUP BY)
│       └── datasets.py                ← Dataset registry
│
├── cli/                               ← `dbrip` CLI — 5 commands, 21 tests
│   ├── __init__.py
│   └── dbrip.py                       ← Typer + httpx; thin wrapper around the API
│
├── frontend/                          ← React SPA — see frontend/README.md
│   └── src/
│
├── tests/                             ← 60 tests (pytest)
│   ├── fixtures/sample.csv            ← 5-row subset for fast tests
│   ├── test_ingest.py                 ← Ingest pipeline tests (13 tests)
│   ├── test_api.py                    ← API endpoint tests (26 tests)
│   └── test_cli.py                    ← CLI command tests (21 tests)
│
├── docs/                              ← MkDocs source pages (served by the frontend Docs tab)
├── alembic/                           ← Database migrations (placeholder — see alembic/README.md)
├── mcp/                               ← MCP server for Claude (planned)
└── pyproject.toml                     ← Dependencies and project config
```

## Core Design Principles

1. **CSV is the source of truth** — the database is always rebuildable from `data/raw/`
2. **API is read-only** — no write endpoints; data management lives in `scripts/`
3. **No data cleaning** — nulls and unexpected values are preserved exactly as-is from the CSV
4. **scripts/ is standalone** — bioinformaticians run scripts directly, the API never imports them
5. **Modular loaders** — new dataset = new manifest YAML + new loader class, nothing else changes

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/health` | Health check |
| `GET /v1/insertions` | List insertions with filters and pagination |
| `GET /v1/insertions/{id}` | Single insertion with population frequencies |
| `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}` | Region query |
| `GET /v1/export?format=bed\|vcf\|csv` | Export with same filters |
| `GET /v1/stats?by=me_type\|chrom\|variant_class` | Summary counts |
| `GET /v1/datasets` | List loaded datasets |

### Filter Parameters

All query endpoints accept these optional filters (AND logic):

| Param | Example | Description |
|-------|---------|-------------|
| `me_type` | `ALU` | TE family |
| `me_subtype` | `AluYa5` | TE subfamily |
| `me_category` | `Non-reference` | Reference or polymorphic |
| `variant_class` | `Common` | Frequency class |
| `annotation` | `INTRONIC` | Genomic context |
| `population` | `EUR` | Filter by population frequency |
| `min_freq` | `0.05` | Minimum allele frequency (requires `population`) |
| `max_freq` | `0.50` | Maximum allele frequency (requires `population`) |
| `limit` | `50` | Page size (max 1000) |
| `offset` | `0` | Pagination offset |

## Data Management

Data is managed through scripts, not the API:

```bash
# Load the full dataset
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# Load a corrections CSV (only updates those rows)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml \
                         --csv data/raw/corrections.csv

# Validate without writing to DB
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run

# Check what's loaded
python scripts/ingest.py --status
```

Or fix rows directly in SQL:
```sql
UPDATE insertions SET annotation = 'INTRONIC' WHERE id = 'A0000001';
```

## Running Tests

```bash
source .venv/bin/activate
pytest tests/ -v
```

## Why is alembic/ empty?

Alembic is a database migration tool for evolving schemas without losing data.
Right now `scripts/ingest.py` creates tables from scratch, which works fine for
SQLite in development. Alembic becomes necessary when deploying to PostgreSQL in
production — you can't drop and recreate tables without losing data. See
[alembic/README.md](alembic/README.md) for setup instructions when ready.

## Switching to PostgreSQL

Set the `DATABASE_URL` environment variable:
```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/dbrip"
uvicorn app.main:app --reload
```

Everything else stays the same — the ORM models and queries work identically on both SQLite and PostgreSQL.
