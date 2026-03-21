# dbRIP API — Guide

---

## Contents

1. [Quick start](#1-quick-start)
2. [How the programs fit together](#2-how-the-programs-fit-together)
3. [Maintenance — changing the data or schema](#3-maintenance--changing-the-data-or-schema)
   - [Rebuild the database](#rebuild-the-database)
   - [Add a new population column](#add-a-new-population-column)
   - [Rename a population column](#rename-a-population-column)
   - [Add a new metadata column](#add-a-new-metadata-column)
   - [Rename a metadata column](#rename-a-metadata-column)
   - [Add / edit / remove a single row](#add--edit--remove-a-single-row)
4. [Track Hub — building and deploying](#4-track-hub--building-and-deploying)
   - [What the track hub is](#what-the-track-hub-is)
   - [Build locally (dry run)](#build-locally-dry-run)
   - [Build locally (full)](#build-locally-full)
   - [Test in UCSC browser](#test-in-ucsc-browser)
   - [How CI deploys automatically](#how-ci-deploys-automatically)
   - [Check if the hub is stale](#check-if-the-hub-is-stale)
   - [Update when the repo is forked](#update-when-the-repo-is-forked)
5. [File reference](#5-file-reference)
6. [How a request flows through the system](#6-how-a-request-flows-through-the-system)

---

## 1. Quick start

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

# Start the frontend
cd frontend && npm run dev
```

---

## 2. How the programs fit together

There are three completely separate programs in this repo. They share a database
but **never import each other**:

```
  data/raw/dbRIP_all.csv
        │
        ▼
  ┌─────────────────────┐
  │  scripts/ingest.py  │   ← You run this once to load the CSV into SQLite.
  │  (standalone script) │     Uses ingest/ to parse the CSV.
  └─────────┬───────────┘
            │ writes to
            ▼
  ┌─────────────────────┐
  │   dbrip.sqlite      │   ← The database (insertions + pop_frequencies tables)
  └─────────┬───────────┘
            │ reads from
            ▼
  ┌─────────────────────┐
  │  app/ (FastAPI)     │   ← The API server — answers HTTP queries.
  │  uvicorn app.main   │     Returns JSON, BED, VCF, CSV.
  └─────────────────────┘
            │ fetched by
            ▼
  ┌─────────────────────┐
  │  frontend/ (React)  │   ← The browser UI — calls the FastAPI endpoints.
  └─────────────────────┘
```

**If you want to update data:** edit the CSV and re-run `scripts/ingest.py`.
**If you want to query data:** hit the API (or use the frontend).

Key design rules:
- **CSV is the source of truth.** The database is always rebuildable from `data/raw/`.
- **API is read-only.** No write endpoints — data management lives in `scripts/`.
- **No data cleaning.** Nulls and empty strings are preserved exactly as-is from the CSV.

---

## 3. Maintenance — changing the data or schema

> **Never edit the SQLite database directly.** It is always rebuilt from the CSV
> and manifest by running `scripts/ingest.py`. Any direct edits will be lost the
> next time the script runs.

### Rebuild the database

Run this after any change to the CSV or manifest:

```bash
source .venv/bin/activate

# Dry run — validates the CSV without writing anything
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run

# Full ingest — drops and recreates all tables
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# Check what is currently loaded
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --status
```

---

### Add a new population column

**Scenario:** A new population code (e.g. `ACB_2`) has been added to the CSV.

**Step 1 — `data/raw/*.csv`**
Add the new column header. Empty cells are fine — nulls are preserved exactly.

**Step 2 — `data/manifests/dbrip_v1.yaml`**
Add the code to `population_columns` in the position you want it to appear:
```yaml
population_columns:
  - All
  - Non_African
  - AFR
  - ACB
  - ACB_2    # ← add here
```

**Step 3 — Re-ingest** (see [Rebuild the database](#rebuild-the-database))

`ingest/dbrip.py` reads population columns from the manifest automatically — no
code change is needed there unless `ACB_2` needs special type handling.

**Step 4 — `frontend/src/constants/filters.ts`** — two additions:

```ts
// 1. Flat dropdown (Population filter)
export const POPULATIONS: FilterOption[] = [
  ...
  { value: "ACB_2", label: "ACB_2 — Description here" },  // add
];

// 2. Grouped table (PopFreqTable in InteractiveSearch)
export const POP_GROUPS = [
  { label: "AFR", pops: ["AFR", "ACB", "ACB_2", ...] },  // add to correct group
  ...
];
// The total number of pops across all groups must equal the count of
// population_columns in the manifest — the comment in filters.ts tracks this.
```

**Step 5 — `frontend/src/pages/InteractiveSearch.tsx`**
Add `"ACB_2"` to `POP_ORDER` in the same relative position as in the manifest.
This controls the clipboard copy column order.

**Step 6 — Verify**
```bash
cd frontend && npx tsc --noEmit
```

---

### Rename a population column

**Scenario:** `Non_African` → `Non_AFR` everywhere.

| # | File | Change |
|---|------|--------|
| 1 | `data/raw/*.csv` | Rename the column header |
| 2 | `data/manifests/dbrip_v1.yaml` | Update the entry in `population_columns` |
| 3 | *(run)* | Re-ingest |
| 4 | `frontend/src/constants/filters.ts` | Update the `value` string in `POPULATIONS` and the entry in `POP_GROUPS` |
| 5 | `frontend/src/pages/InteractiveSearch.tsx` | Update `POP_ORDER` |
| 6 | *(verify)* | `cd frontend && npx tsc --noEmit` |

---

### Add a new metadata column

**Scenario:** A new column `source_study` is being added to every insertion row.

| # | File | Change |
|---|------|--------|
| 1 | `data/raw/*.csv` | Add column header and fill in values |
| 2 | `data/manifests/dbrip_v1.yaml` | Add `source_study: source_study` to `column_map` |
| 3 | *(check)* `ingest/dbrip.py` | If the column needs type coercion or splitting, add it in `_transform`. Plain strings pass through automatically. |
| 4 | *(run)* | Re-ingest |
| 5 | `app/models.py` | Add `source_study = Column(String, nullable=True)` to `Insertion` |
| 6 | `app/schemas.py` | Add `source_study: str \| None` to `InsertionSummary` and/or `InsertionDetail` |
| 7 | *(optional)* `app/routers/insertions.py` | Add a query param + WHERE clause if users should be able to filter by this field — follow the pattern of the existing `annotation` filter |
| 8 | `frontend/src/types/insertion.ts` | Add `source_study: string \| null` to the TypeScript interface |
| 9 | `frontend/src/pages/InteractiveSearch.tsx` | Add `{ accessorKey: "source_study", header: "Source Study" }` to the `columns` array |
| 10 | *(optional)* `frontend/src/constants/filters.ts` | If the field has a fixed set of values, add a `SOURCE_STUDY_OPTIONS` array and wire up a `<select>` in the page's filter section |
| 11 | *(verify)* | `cd frontend && npx tsc --noEmit && cd .. && pytest tests/ -v` |

---

### Rename a metadata column

**Scenario:** `variant_class` → `variant_type` everywhere.

| # | File | Change |
|---|------|--------|
| 1 | `data/raw/*.csv` | Rename the column header |
| 2 | `data/manifests/dbrip_v1.yaml` | Update the key in `column_map` |
| 3 | *(run)* | Re-ingest |
| 4 | `app/models.py` | Rename the attribute on the `Insertion` class |
| 5 | `app/schemas.py` | Rename the field in `InsertionSummary` / `InsertionDetail` |
| 6 | `app/routers/insertions.py` | Update any `Insertion.variant_class` references in filter logic |
| 7 | `frontend/src/types/insertion.ts` | Rename the field in the TypeScript interface |
| 8 | `frontend/src/pages/InteractiveSearch.tsx` | Update `accessorKey`, any related state variable names, and `COLUMN_HEADERS` |
| 9 | *(verify)* | `cd frontend && npx tsc --noEmit && cd .. && pytest tests/ -v` |

---

### Add / edit / remove a single row

Always edit the CSV first, then re-ingest. The database is always rebuilt from
scratch — do not edit `dbrip.sqlite` directly.

```bash
# After editing data/raw/*.csv:
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run  # preview
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml             # apply
```

To temporarily add a row for testing without touching the CSV, use the SQLite
CLI — but be aware this row will be gone the next time ingest runs:

```bash
sqlite3 dbrip.sqlite
INSERT INTO insertions (id, chrom, start, end, me_category, me_type, ...)
  VALUES ('TEST001', 'chr1', 100000, 100001, 'Non-reference', 'ALU', ...);
-- Also add 33 rows to pop_frequencies for this insertion if needed.
.quit
```

---

### Key invariants to maintain

| Rule | Where to check |
|------|---------------|
| Population column count | `POP_GROUPS` pops arrays in `filters.ts` must sum to the same number as `population_columns` in the manifest |
| Pop codes match the DB | `POPULATIONS` values and `POP_GROUPS` entries must use the exact strings stored in `pop_frequencies.population` |
| `column_map` covers every column | `data/manifests/dbrip_v1.yaml` |
| ORM schema matches ingest schema | `app/models.py` column names must match the `CREATE TABLE` SQL in `scripts/ingest.py` |
| CSV is source of truth | Never edit the SQLite DB directly — always re-run `scripts/ingest.py` |

---

## 4. Track Hub — building and deploying

### What the track hub is

The UCSC Genome Browser can load custom datasets via a **Track Hub** — a small set
of config files you host on any public HTTPS server. When a researcher loads the hub,
UCSC shows dbRIP insertions as colored horizontal bars on the genome, one sub-track
per ME family (ALU red, LINE1 blue, SVA green).

The data lives in **bigBed** files — sorted, indexed binary files that UCSC fetches
via HTTP byte-range requests (only the visible window, not the entire file). The
build script (`scripts/build_trackhub.py`) converts the API's BED6 export into bigBed.

### Build locally (dry run)

Renders the hub config templates without calling bedToBigBed. No UCSC tools needed.
You still need the API running (for `--me-types all` auto-detection), or pass
`--me-types ALU LINE1 SVA` explicitly.

```bash
source .venv/bin/activate

# Load DB and start API
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
uvicorn app.main:app --host 127.0.0.1 --port 8000 &

# Dry run
python scripts/build_trackhub.py \
  --api-url http://localhost:8000 \
  --hub-url https://aryan-jhaveri.github.io/dbRIP/hub \
  --dry-run

# Check output
ls hub/
# hub.txt  genomes.txt  hg38/trackDb.txt  hg38/dbRIP.html
```

### Build locally (full)

Requires `bedToBigBed` and `fetchChromSizes` on PATH.

```bash
# Install UCSC tools (conda)
conda install -c bioconda ucsc-bedtobigbed ucsc-fetchchromsizes

# Or download static binaries (Linux x86_64)
wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/bedToBigBed
wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/fetchChromSizes
chmod +x bedToBigBed fetchChromSizes

# macOS binaries (if on a Mac)
wget https://hgdownload.soe.ucsc.edu/admin/exe/macOSX.x86_64/bedToBigBed
wget https://hgdownload.soe.ucsc.edu/admin/exe/macOSX.x86_64/fetchChromSizes
chmod +x bedToBigBed fetchChromSizes

# Full build (API must be running)
python scripts/build_trackhub.py \
  --api-url http://localhost:8000 \
  --hub-url https://aryan-jhaveri.github.io/dbRIP/hub

# Check output
ls hub/hg38/
# trackDb.txt  dbRIP.html  hg38.chrom.sizes
# dbrip_alu_hg38.bb  dbrip_line1_hg38.bb  dbrip_sva_hg38.bb
```

### Test in UCSC browser

After a full build, serve the hub locally and point UCSC at it:

```bash
# Serve on your local machine
python -m http.server 8080 --directory .

# In UCSC: My Data → Track Hubs → My Hubs → paste:
#   http://YOUR_LOCAL_IP:8080/hub/hub.txt
# (UCSC must be able to reach your machine — use ngrok for a public tunnel)
```

### How CI deploys automatically

The GitHub Actions workflow (`.github/workflows/build-trackhub.yml`) runs the full
pipeline whenever `data/raw/dbRIP_all.csv` or `frontend/src/**` changes on `main`:

1. Builds SQLite from CSV
2. Starts uvicorn locally on the CI runner
3. Runs `build_trackhub.py` → bigBed files + hub config
4. Builds the React frontend with `VITE_API_URL` baked in
5. Deploys both to the `gh-pages` branch (frontend at `/`, hub at `/hub/`)

You can also trigger it manually: GitHub → Actions → "Build Track Hub + Frontend" → Run workflow.

### Check if the hub is stale

After updating the CSV and re-ingesting, check whether the hub needs rebuilding:

```bash
# Start the API, then:
python scripts/build_trackhub.py --status

# Output:
#   ME Type      Hub count   API count   Status
#   ALU            33709       33709     OK
#   LINE1           6958        7100     STALE
```

If any type shows STALE, push the new CSV to `main` and the CI workflow rebuilds automatically.

### Update when the repo is forked

The CI workflow builds the hub URL dynamically from the GitHub repo owner and name:
```
https://<owner>.github.io/<repo>/hub
```

When the lab forks this repo, the URL updates automatically. The only thing to change
is the `RENDER_API_URL` env var in `.github/workflows/build-trackhub.yml` if the
Render API moves to a different host.

---

## 5. File reference

### `data/manifests/dbrip_v1.yaml`

The contract between the raw CSV and the ingest pipeline. Three key fields:
- `column_map` — maps CSV column headers to normalised database field names (e.g. `Chromosome` → `chrom`)
- `population_columns` — the 33 population frequency columns that get melted from wide to long
- `loader_class` — the Python class that knows how to parse this specific CSV

Adding a new dataset (e.g. euL1db) means writing a new YAML and a new loader
class — no changes to the existing files.

---

### `ingest/base.py`

Abstract base class defining the 4-step ETL contract. Every loader must follow:

1. `load_raw()` — read the CSV
2. `normalize()` — rename columns, cast types (no data removal)
3. `to_insertions()` — produce rows for the `insertions` table
4. `to_pop_frequencies()` — melt population columns to long format

The `run()` method calls these in order. Subclasses fill in the steps but never
override `run()`. This is the Template Method pattern — it guarantees every
loader follows the same flow.

---

### `ingest/dbrip.py`

The dbRIP-specific loader. The only file that knows the shape of the dbRIP CSV.

- `load_raw()` — reads the CSV with `pd.read_csv()`, skips the R-generated row index
- `normalize()` — renames columns using `column_map`, casts coordinates to int and frequencies to float
- `to_insertions()` — picks the 13 insertion columns, tags each row with `dataset_id`
- `to_pop_frequencies()` — uses `pd.melt()` to reshape wide → long (44,984 rows × 33 pops = 1.48M rows)

---

### `scripts/ingest.py`

Standalone CLI — the only way to write to the database.

1. Reads the manifest YAML
2. Imports the loader class dynamically
3. Calls `loader.run()` → gets `(insertions, pop_frequencies)` as lists of dicts
4. Drops and recreates tables, then bulk-inserts rows

Flags: `--dry-run`, `--csv` (override CSV path), `--status`, `--db` (default: `dbrip.sqlite`)

---

### `app/models.py`

SQLAlchemy ORM models — Python classes that map to database tables.

- `DatasetRegistry` — tracks loaded datasets (name, version, row count, timestamp)
- `Insertion` — one row per TE insertion. 15 columns matching the CSV.
- `PopFrequency` — one row per insertion × population (1.48M rows). Composite primary key: `(insertion_id, population)`.

`Insertion.pop_frequencies` is a SQLAlchemy relationship — accessing it triggers
a JOIN automatically. The column schemas here must match the `CREATE TABLE` SQL
in `scripts/ingest.py`; if you add a column to one, add it to the other.

---

### `app/schemas.py`

Pydantic schemas — define the shape of JSON responses.

- `InsertionSummary` — lightweight (no population frequencies), used in list endpoints
- `InsertionDetail` — full detail with nested `populations` list, used for single-record endpoints
- `PaginatedResponse` — wraps list results with `total`, `limit`, `offset`

`from_attributes=True` lets Pydantic read directly from SQLAlchemy objects, so
routes can return ORM objects and Pydantic serialises them to JSON automatically.

---

### `app/routers/insertions.py`

The main query endpoints.

- `GET /v1/insertions` — paginated list with filters
- `GET /v1/insertions/{id}` — single insertion with all 33 population frequencies
- `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}` — region overlap query

`_apply_filters()` is a shared helper used by both list and region endpoints so
filtering logic isn't duplicated. Population-frequency filtering requires a JOIN
to `pop_frequencies`.

---

### `app/routers/export.py`

Download endpoints — BED, VCF, or CSV.

- **BED6** — 0-based coordinates (converted from DB's 1-based). Used by bedtools, UCSC Genome Browser.
- **VCF 4.2** — 1-based (no conversion needed). Used by variant callers.
- **CSV** — flat file, all columns.

Accepts the same filter params as `/v1/insertions`, so you can export a filtered
subset (`?format=bed&me_type=ALU&population=EUR&min_freq=0.1`).

---

### `app/routers/stats.py`

Aggregation endpoint: `GET /v1/stats?by=me_type` returns label + count pairs.
`ALLOWED_GROUP_BY` maps query param values to ORM columns — only explicitly
listed fields can be used, preventing arbitrary column access.

---

### `frontend/src/constants/filters.ts`

Single source of truth for all dropdown options used across pages.

- `POPULATIONS` — flat list for the Population filter dropdown
- `POP_GROUPS` — grouped structure for the PopFreqTable grouped headers and toggle buttons
- `ME_TYPE_OPTIONS`, `CATEGORY_OPTIONS`, `ANNOTATION_OPTIONS`, `STRAND_OPTIONS` — fixed-value dropdowns

Add/rename options here so both InteractiveSearch and BatchSearch stay in sync.

---

### `frontend/src/pages/InteractiveSearch.tsx`

The main search tab. Contains:

- `columns` — TanStack Table column definitions for the 13 summary fields
- `POP_ORDER` — canonical population order used when copying rows to the clipboard
- `PopFreqTable` — purely presentational component: receives `activeGroups` from
  the parent and renders a grouped 3-row table (group headers / pop codes / AF values)
- `activeGroups` / `toggleGroup` — global state in `InteractiveSearch` so that all
  expanded rows follow the same group visibility at once

---

### `scripts/build_trackhub.py`

Standalone CLI — builds the UCSC Track Hub from the running API.

1. Auto-detects ME types from `GET /v1/stats?by=me_type`
2. For each ME type: exports BED6 → sorts → converts to bigBed
3. Renders hub config templates → `hub/` directory
4. Writes `.build_meta.json` for stale detection

Flags: `--api-url`, `--hub-url`, `--output-dir`, `--assemblies`, `--me-types`,
`--hg19-fasta`, `--dry-run`, `--status`

---

### `data/hub/templates/`

UCSC Track Hub configuration templates:

- `hub.txt` — entry point (no placeholders, copied as-is)
- `genomes.txt` — one stanza per assembly (`{assembly}` placeholder)
- `trackDb_composite.txt` — composite parent header (no placeholders)
- `trackDb_subtrack.txt` — per-ME-type sub-track (`{me_type}`, `{hub_url}`, `{assembly}`, `{color}`)
- `dbRIP.html` — track description popup (no placeholders)

Templates have comment blocks explaining the format for new RAs. The build script
strips comments when rendering output to `hub/`.

---

### `tests/`

- `tests/fixtures/sample.csv` — 5-row subset of the real CSV (3 ALU, 1 LINE1, 1 SVA; edge cases: null TSD, null annotation)
- `tests/test_ingest.py` — 13 tests: row counts, column renaming, population melt, null preservation
- `tests/test_api.py` — 26 tests: endpoints, filters, pagination, export formats, 404s/400s
- `tests/test_build_trackhub.py` — 31 tests: template rendering, FASTA parsing, BED output, build metadata, tool detection

Test database: a pytest fixture creates a temporary SQLite DB, loads the 5-row fixture via `scripts/ingest.py`, and provides a FastAPI `TestClient` that uses it instead of the production DB.

---

## 6. How a request flows through the system

```
Browser sends:  GET /v1/insertions?me_type=ALU&limit=10

  app/main.py
  └─ routes to insertions router
        │
  app/routers/insertions.py  →  list_insertions()
  ├─ get_db() provides a SQLAlchemy session
  ├─ _apply_filters() builds query:
  │      db.query(Insertion).filter(Insertion.me_type == "ALU")
  └─ executes query, gets ORM objects
        │
  app/models.py  →  SQLAlchemy generates:
  │      SELECT * FROM insertions WHERE me_type = 'ALU' ORDER BY id LIMIT 10
        │
  dbrip.sqlite  →  returns rows
        │
  app/schemas.py  →  Pydantic serialises ORM objects → JSON
        │
  Response:
  {"total": 33709, "limit": 10, "offset": 0, "results": [{...}, ...]}
```
