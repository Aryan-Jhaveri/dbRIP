# dbRIP API — How It Works

A walkthrough of every file in the project, what it does, and how the pieces connect.

---

## The Big Picture

There are three completely separate programs in this repo. They share a database but never import each other:

```
  data/raw/dbRIP_all.csv
        │
        ▼
  ┌─────────────────────┐
  │  scripts/ingest.py  │   ← You run this once to load the CSV into SQLite
  │  (standalone script) │     It uses ingest/ to parse the CSV
  └─────────┬───────────┘
            │ writes to
            ▼
  ┌─────────────────────┐
  │   dbrip.sqlite      │   ← The database (3 tables)
  └─────────┬───────────┘
            │ reads from
            ▼
  ┌─────────────────────┐
  │  app/ (FastAPI)     │   ← The API server — answers HTTP queries
  │  uvicorn app.main   │     Returns JSON, BED, VCF, CSV
  └─────────────────────┘
```

If you want to update data, you run `scripts/ingest.py` again. If you want to query data, you hit the API. They don't know about each other.

---

## File-by-File Walkthrough

### `data/manifests/dbrip_v1.yaml`

**What:** A YAML file that describes the shape of the dbRIP CSV.

**Why it exists:** The ingest pipeline needs to know things like "which CSV column becomes the `chrom` column in the database?" and "which columns are population frequencies?" Instead of hardcoding this, we put it in a YAML file. This means adding a new dataset (like euL1db) is just writing a new YAML — no code changes.

**Key fields:**
- `column_map` — maps CSV column names to database column names (e.g. `Chromosome` → `chrom`)
- `population_columns` — lists the 33 population frequency columns that need to be melted from wide to long format
- `loader_class` — points to the Python class that knows how to parse this specific CSV

---

### `ingest/base.py`

**What:** An abstract base class that defines the 4-step ETL contract.

**Why it exists:** Every dataset loader must follow the same pipeline:
1. `load_raw()` — read the CSV
2. `normalize()` — rename columns, cast types (NO data removal)
3. `to_insertions()` — produce rows for the insertions table
4. `to_pop_frequencies()` — melt population columns into long format

The `run()` method calls these 4 steps in order. Subclasses fill in the steps; they never override `run()`. This is the [Template Method pattern](https://en.wikipedia.org/wiki/Template_method_pattern) — it guarantees every loader follows the same flow.

**Key design decision:** No data cleaning. The CSV is the source of truth. Nulls and empty strings are preserved exactly as-is.

---

### `ingest/dbrip.py`

**What:** The dbRIP-specific loader. This is the only file that knows what the dbRIP CSV looks like.

**What it does:**
- `load_raw()` — reads the CSV with `pd.read_csv()`, skipping the R-generated row index column
- `normalize()` — renames columns using the manifest's `column_map`, casts coordinates to integers and frequencies to floats
- `to_insertions()` — picks the 13 insertion columns, tags each row with `dataset_id` and `assembly`
- `to_pop_frequencies()` — uses `pd.melt()` to reshape 33 wide population columns into long format (one row per insertion × population = 1.48M rows)

**If you're adding a new dataset:** Write a new class that inherits from `BaseLoader` (e.g. `EuL1dbLoader`), implement the 4 methods, and create a new manifest YAML. Nothing else in the codebase changes.

---

### `scripts/ingest.py`

**What:** A standalone CLI script that loads a CSV into the SQLite database.

**Why standalone:** Bioinformaticians run this directly from the terminal. It doesn't depend on FastAPI or the API server — it uses raw SQL to create tables and insert rows. This keeps it simple and readable for people who aren't web developers.

**How it works:**
1. Reads the manifest YAML
2. Dynamically imports the loader class (e.g. `ingest.dbrip.DbRIPLoader`)
3. Calls `loader.run()` to get `(insertions, pop_frequencies)` — two lists of dicts
4. Creates the database tables if they don't exist
5. Uses `INSERT OR REPLACE` (upsert) to write rows — safe to re-run
6. Registers the dataset in `dataset_registry` for tracking

**Important flags:**
- `--dry-run` — validates the CSV without writing to the database
- `--csv` — override the CSV path (e.g. for a corrections file)
- `--status` — shows what datasets are currently loaded
- `--db` — specify a different database file (default: `dbrip.sqlite`)

---

### `app/database.py`

**What:** Creates the SQLAlchemy engine and session factory.

**Why it exists:** This is the only file in `app/` that knows which database we're connecting to. Every router imports `get_db` from here and doesn't care whether it's SQLite or PostgreSQL underneath.

**Key concepts:**
- **Engine** — the connection to the database. Created once when the app starts.
- **Session** — a short-lived conversation with the database. Each HTTP request gets its own session.
- **`get_db()`** — a generator that FastAPI calls automatically (via dependency injection) to provide a session to each request, and closes it when the request is done.

**Switching databases:** Set `DATABASE_URL=postgresql://...` as an environment variable. Everything else stays the same.

---

### `app/models.py`

**What:** SQLAlchemy ORM models — Python classes that map to database tables.

**Why it exists:** Instead of writing raw SQL in every route (`SELECT * FROM insertions WHERE id = ?`), you write Python: `db.query(Insertion).filter_by(id="A0000001")`. SQLAlchemy translates between Python objects and SQL rows automatically.

**Three models:**
- `DatasetRegistry` — tracks loaded datasets (id, version, row count, timestamp)
- `Insertion` — one row per TE insertion (44,984 rows). Has 15 columns matching the CSV.
- `PopFrequency` — one row per insertion × population (1.48M rows). Composite primary key: `(insertion_id, population)`.

**Relationships:** `Insertion.pop_frequencies` lets you access all 33 population rows for an insertion as a Python list, without writing a JOIN. SQLAlchemy does the JOIN behind the scenes.

**Important:** The table schemas here must match `scripts/ingest.py`'s `CREATE TABLE` SQL. If you change a column in one, change it in the other.

---

### `app/schemas.py`

**What:** Pydantic response schemas — define the shape of JSON responses.

**How it differs from models.py:**
- `models.py` = how data is **stored** (Python ↔ database)
- `schemas.py` = how data is **sent** over HTTP (Python ↔ JSON)

**Key schemas:**
- `InsertionSummary` — lightweight, used in list endpoints (no population frequencies)
- `InsertionDetail` — full detail with nested `populations` list, used for single-record endpoints
- `PaginatedResponse` — wraps list results with `total`, `limit`, `offset`
- `StatsResponse` — for aggregation endpoints (label + count pairs)

**`from_attributes=True`:** Tells Pydantic "read data from SQLAlchemy objects, not just dicts." This lets you return ORM objects directly from FastAPI routes — Pydantic converts them to JSON automatically.

---

### `app/main.py`

**What:** The FastAPI app entry point. Creates the app and registers all routers.

**What it does:**
- Creates the FastAPI instance with title, description, version
- Adds CORS middleware (allows requests from any origin — needed for web frontends)
- Registers the 4 routers (insertions, stats, datasets, export)
- Defines the `/v1/health` endpoint

**How to run:** `uvicorn app.main:app --reload` — starts the server on http://localhost:8000. The `--reload` flag watches for file changes and restarts automatically (development only).

---

### `app/routers/insertions.py`

**What:** The main query endpoints — list, get by ID, and region queries.

**Endpoints:**
- `GET /v1/insertions` — paginated list with optional filters
- `GET /v1/insertions/{id}` — single insertion with all 33 population frequencies
- `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}` — region query

**How filtering works:** Query parameters are optional. They stack with AND logic. For example, `?me_type=ALU&variant_class=Common` returns only ALU insertions that are also Common. Population-based filtering (`?population=EUR&min_freq=0.1`) requires a JOIN to the `pop_frequencies` table.

**`_apply_filters()`** is a shared helper that both the list and region endpoints use, so filtering logic isn't duplicated.

---

### `app/routers/export.py`

**What:** Export endpoints — download insertions as BED, VCF, or CSV files.

**Formats:**
- **BED6** — 0-based coordinates (converted from the DB's 1-based). Used by bedtools, UCSC Genome Browser.
- **VCF 4.2** — 1-based (no conversion needed). Used by variant callers.
- **CSV** — flat file with all columns.

**Coordinate conversion:** The database stores 1-based coordinates (matching the source CSV). BED requires 0-based, so the export converts: `bed_start = db_start - 1`. This conversion happens only at the export boundary — the DB always stores 1-based.

**Uses the same filters** as `/v1/insertions` — you can export a subset like `?format=bed&me_type=ALU&population=EUR&min_freq=0.1`.

---

### `app/routers/stats.py`

**What:** Aggregation endpoint — summary counts grouped by a field.

**Example:** `GET /v1/stats?by=me_type` returns:
```json
{"group_by": "me_type", "entries": [
    {"label": "ALU", "count": 33709},
    {"label": "LINE1", "count": 6468},
    {"label": "SVA", "count": 4697},
    {"label": "HERVK", "count": 101}
]}
```

**`ALLOWED_GROUP_BY` dict** maps query param values to ORM columns. This prevents arbitrary column access (you can only group by fields we've explicitly allowed).

---

### `app/routers/datasets.py`

**What:** Shows what datasets are loaded in the database.

**Why it exists:** After running `scripts/ingest.py`, you can hit `GET /v1/datasets` to verify the data loaded correctly and see when it was last updated.

---

### `tests/fixtures/sample.csv`

**What:** A 5-row subset of the real dbRIP CSV, used for fast tests.

**Why 5 rows:** Tests need to run in milliseconds, not seconds. The 5 rows cover edge cases: 3 ALU, 1 LINE1, 1 SVA, 2 rows with null TSD, 1 row with null annotation.

---

### `tests/test_ingest.py` (13 tests)

**What it tests:**
- BaseLoader can't be instantiated directly (it's abstract)
- Row counts match the CSV (no rows dropped)
- Columns are renamed correctly
- Population columns are melted correctly (5 rows × 33 pops = 165)
- Nulls are preserved (not silently removed)
- Coordinates are integers, frequencies are floats

---

### `tests/test_api.py` (26 tests)

**What it tests:**
- Every endpoint returns correct HTTP status codes
- Response shapes match Pydantic schemas
- Filtering works (me_type, region, population)
- Pagination works (limit, offset, total count)
- Export formats are valid (BED is 0-based, VCF has headers, CSV has column names)
- 404s for missing resources, 400s for invalid inputs

**How the test database works:** A pytest fixture creates a temporary SQLite database, loads the 5-row sample CSV into it using `scripts/ingest.py`, and provides a FastAPI `TestClient` that uses this test database instead of the real one.

---

## How a Request Flows Through the System

```
Browser/CLI/Claude sends:
    GET /v1/insertions?me_type=ALU&limit=10

    ┌──────────────────────────────────────┐
    │  app/main.py                         │
    │  FastAPI receives the request        │
    │  Routes it to insertions.router      │
    └──────────────┬───────────────────────┘
                   │
    ┌──────────────▼───────────────────────┐
    │  app/routers/insertions.py           │
    │  list_insertions() runs              │
    │  - get_db() provides a DB session    │
    │  - Builds SQLAlchemy query with      │
    │    filters: .filter(me_type == ALU)  │
    │  - Executes query, gets ORM objects  │
    └──────────────┬───────────────────────┘
                   │
    ┌──────────────▼───────────────────────┐
    │  app/models.py                       │
    │  SQLAlchemy translates to SQL:       │
    │  SELECT * FROM insertions            │
    │  WHERE me_type = 'ALU'              │
    │  ORDER BY id LIMIT 10               │
    └──────────────┬───────────────────────┘
                   │
    ┌──────────────▼───────────────────────┐
    │  dbrip.sqlite                        │
    │  Database returns rows               │
    └──────────────┬───────────────────────┘
                   │
    ┌──────────────▼───────────────────────┐
    │  app/schemas.py                      │
    │  Pydantic validates + serializes     │
    │  ORM objects → JSON                  │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    {"total": 33709, "limit": 10, "offset": 0,
     "results": [{...}, {...}, ...]}
```
