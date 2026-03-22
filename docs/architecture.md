# Architecture

## Three separate programs

There are three programs in this repo. They share a database but never import each other:

```
  data/raw/dbRIP_all.csv
        |
        v
  scripts/ingest.py        <- You run this once to load the CSV into SQLite.
  (standalone script)          Uses ingest/ to parse the CSV.
        |
        | writes to
        v
  dbrip.sqlite              <- The database (insertions + pop_frequencies tables)
        |
        | reads from
        v
  app/ (FastAPI)             <- The API server. Answers HTTP queries.
  uvicorn app.main              Returns JSON, BED, VCF, CSV.
        |
        | fetched by
        v
  frontend/ (React)          <- The browser UI. Calls the FastAPI endpoints.
```

If you want to update data: edit the CSV and re-run `scripts/ingest.py`.
If you want to query data: hit the API (or use the frontend, CLI, or MCP).

## Design rules

1. **CSV is the source of truth.** The database is always rebuildable from `data/raw/`.
2. **API is read-only.** No write endpoints. Data management lives in `scripts/`.
3. **No data cleaning.** Nulls, empty strings, and unexpected values are preserved exactly as-is from the CSV. The people maintaining the database decide what to do with them.
4. **scripts/ is standalone.** Scripts are run directly by bioinformaticians. They are never imported by the API.
5. **Assembly is configurable.** The genome assembly (hg38, hs1, etc.) is set in the manifest YAML, not hardcoded in the schema or API. The DB can hold any assembly. Several downstream tools default to hg38 (CLI region search, track hub build) but accept other values. See [Switching assemblies](maintenance.md#switching-assemblies-eg-hg38-to-t2t-chm13) for details.

## Who does what

| Person | Tool | Task |
|--------|------|------|
| Researcher (query) | API / CLI / Claude | Search insertions, export BED/VCF, ask questions |
| Bioinformatician (data) | Python scripts + SQL | Load CSVs, patch rows, inspect the DB |
| Developer (build) | Full repo | Add new datasets, extend the schema, deploy |

## Technology stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Backend | FastAPI + Uvicorn | Fast, built-in OpenAPI docs, async-ready |
| ORM | SQLAlchemy 2.x | Pythonic SQL, relationships |
| DB (dev) | SQLite | Fast local development, no server setup |
| DB (prod) | PostgreSQL | ACID compliance, scalability |
| Validation | Pydantic v2 | Type-safe schemas, `from_attributes` for ORM-to-JSON |
| Frontend | Vite + React 18 + TypeScript | Static SPA, no Node server needed |
| Tables | TanStack Table v8 | Headless data table, server-side pagination |
| Query | TanStack Query v5 | Caching, loading states, background refetch |
| Styling | Tailwind + shadcn/ui | Accessible components |
| Genome browser | IGV.js | Embeddable viewer, BED track support |
| Track hub host | GitHub Pages | Static files, HTTPS, byte-range support for bigBed |
| API host (prod) | Render | Python process, auto-deploys from main |
| CLI | Typer | Command-line interface |
| MCP | @modelcontextprotocol/sdk | Claude integration |

## Project structure

```
data/raw/dbRIP_all.csv          <- source CSV (the source data)
data/manifests/dbrip_v1.yaml    <- describes the CSV format for ingest
data/hub/templates/             <- UCSC track hub config templates

ingest/                         <- ETL pipeline (BaseLoader + dbRIP-specific loader)
scripts/ingest.py               <- CLI to load CSV into SQLite
scripts/build_trackhub.py       <- CLI to build bigBed + hub config from the API

app/                            <- FastAPI backend (read-only, 7 endpoints)
cli/dbrip.py                    <- CLI (Typer + httpx, talks to hosted API)
frontend/src/                   <- Frontend (Vite + React + TanStack + Tailwind + igv.js)
mcp/                            <- MCP server (Express + @modelcontextprotocol/sdk)
tests/                          <- pytest suite (pytest tests)

.github/workflows/
  docker.yml                    <- CI: test + Docker build
  build-trackhub.yml            <- CI: build hub + frontend -> GitHub Pages
```

## How a request flows through the system

```
Browser sends:  GET /v1/insertions?me_type=ALU&limit=10

  app/main.py
  +-- routes to insertions router
        |
  app/routers/insertions.py  ->  list_insertions()
  |-- get_db() provides a SQLAlchemy session
  |-- _apply_filters() builds query:
  |      db.query(Insertion).filter(Insertion.me_type == "ALU")
  +-- executes query, gets ORM objects
        |
  app/models.py  ->  SQLAlchemy generates:
  |      SELECT * FROM insertions WHERE me_type = 'ALU' ORDER BY id LIMIT 10
        |
  dbrip.sqlite (or PostgreSQL in prod)  ->  returns rows
        |
  app/schemas.py  ->  Pydantic serialises ORM objects -> JSON
        |
  Response:
  {"total": 33709, "limit": 10, "offset": 0, "results": [{...}, ...]}
```

## Change propagation

When you modify data or schema, changes flow bottom-up. The exact files depend on what changed. Here is the general sequence:

```
CSV / YAML manifest
  -> ingest/ (loader)
    -> scripts/ingest.py (re-load)
      -> app/models.py (ORM column)
        -> app/schemas.py (Pydantic field)
          -> app/routers/ (filter param)
            -> frontend/src/types/ (TypeScript type)
              -> frontend/src/constants/filters.ts (dropdown options)
                -> frontend/src/pages/ (table columns, UI controls)
```

See [Maintenance](maintenance.md) for step-by-step instructions for common changes.
