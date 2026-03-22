# Maintenance

## General rule

Never edit the SQLite database directly. It is always rebuilt from the CSV and manifest by running `scripts/ingest.py`. Any direct edits will be lost the next time the script runs.

---

## Rebuild the database

Run this after any change to the CSV or manifest:

```bash
source .venv/bin/activate

# Dry run (validates without writing)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run

# Full ingest (drops and recreates all tables)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# Check what is currently loaded
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --status
```

---

## Add a new population column

Scenario: a new population code (e.g. `ACB_2`) has been added to the CSV.

| Step | File | Change |
|------|------|--------|
| 1 | `data/raw/*.csv` | Add the new column header. Empty cells are fine. |
| 2 | `data/manifests/dbrip_v1.yaml` | Add the code to `population_columns` |
| 3 | (run) | Re-ingest |
| 4 | `frontend/src/constants/filters.ts` | Add to `POPULATIONS` array and the correct group in `POP_GROUPS` |
| 5 | `frontend/src/pages/InteractiveSearch.tsx` | Add to `POP_ORDER` in the same relative position |
| 6 | (verify) | `cd frontend && npx tsc --noEmit` |

`ingest/dbrip.py` reads population columns from the manifest automatically. No code change is needed there unless the column needs special type handling.

---

## Rename a population column

Scenario: `Non_African` becomes `Non_AFR` everywhere.

| Step | File | Change |
|------|------|--------|
| 1 | `data/raw/*.csv` | Rename the column header |
| 2 | `data/manifests/dbrip_v1.yaml` | Update the entry in `population_columns` |
| 3 | (run) | Re-ingest |
| 4 | `frontend/src/constants/filters.ts` | Update the `value` string in `POPULATIONS` and the entry in `POP_GROUPS` |
| 5 | `frontend/src/pages/InteractiveSearch.tsx` | Update `POP_ORDER` |
| 6 | (verify) | `cd frontend && npx tsc --noEmit` |

---

## Add a new metadata column

Scenario: a new column `source_study` is being added to every insertion row.

| Step | File | Change |
|------|------|--------|
| 1 | `data/raw/*.csv` | Add column header and fill in values |
| 2 | `data/manifests/dbrip_v1.yaml` | Add `source_study: source_study` to `column_map` |
| 3 | (check) `ingest/dbrip.py` | If the column needs type coercion or special handling, add it in `normalize()`. Plain strings pass through automatically. |
| 4 | (run) | Re-ingest |
| 5 | `app/models.py` | Add `source_study = Column(String, nullable=True)` to `Insertion` |
| 6 | `app/schemas.py` | Add `source_study: str \| None` to `InsertionSummary` and/or `InsertionDetail` |
| 7 | (optional) `app/routers/insertions.py` | Add a query param + WHERE clause if users should filter by this field. Follow the pattern of the existing `annotation` filter. |
| 8 | `frontend/src/types/insertion.ts` | Add `source_study: string \| null` to the TypeScript interface |
| 9 | `frontend/src/pages/InteractiveSearch.tsx` | Add `{ accessorKey: "source_study", header: "Source Study" }` to the `columns` array |
| 10 | (optional) `frontend/src/constants/filters.ts` | If the field has a fixed set of values, add an options array and wire up a `<select>` dropdown |
| 11 | (verify) | `cd frontend && npx tsc --noEmit && cd .. && pytest tests/ -v` |

---

## Rename a metadata column

Scenario: `variant_class` becomes `variant_type` everywhere.

| Step | File | Change |
|------|------|--------|
| 1 | `data/raw/*.csv` | Rename the column header |
| 2 | `data/manifests/dbrip_v1.yaml` | Update the key in `column_map` |
| 3 | (run) | Re-ingest |
| 4 | `app/models.py` | Rename the attribute on the `Insertion` class |
| 5 | `app/schemas.py` | Rename the field in `InsertionSummary` / `InsertionDetail` |
| 6 | `app/routers/insertions.py` | Update any references in filter logic |
| 7 | `frontend/src/types/insertion.ts` | Rename the field in the TypeScript interface |
| 8 | `frontend/src/pages/InteractiveSearch.tsx` | Update `accessorKey`, any related state names, and `COLUMN_HEADERS` |
| 9 | (verify) | `cd frontend && npx tsc --noEmit && cd .. && pytest tests/ -v` |

---

## Add / edit / remove a single row

Always edit the CSV first, then re-ingest:

```bash
# After editing data/raw/*.csv:
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run   # preview
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml              # apply
```

To temporarily add a row for testing without touching the CSV:

```bash
sqlite3 dbrip.sqlite
INSERT INTO insertions (id, chrom, start, end, me_category, me_type, ...)
  VALUES ('TEST001', 'chr1', 100000, 100001, 'Non-reference', 'ALU', ...);
.quit
```

This row will be gone the next time ingest runs.

---

## Rows with swapped coordinates

Some rows in the source CSV have `End < Start`. These rows are preserved in the database and fully queryable via the API and frontend (per the "no data cleaning" rule). They are silently excluded from the UCSC track hub because bigBed requires `end > start`.

To get the full list for the database curator:

```bash
sqlite3 dbrip.sqlite \
  "SELECT id, chrom, start, \"end\", me_type FROM insertions WHERE \"end\" < start ORDER BY me_type;" \
  > invalid_coords.txt
```

Options:

- If the coordinates are simply swapped: fix `Start` and `End` in the CSV for those rows, re-ingest. The track hub will pick them up on the next CI run.
- If the source data is authoritative: leave as-is. The track hub gap is expected and documented.

---

## Switching assemblies (e.g. hg38 to T2T-CHM13)

The database assembly is set by the manifest (`assembly: hg38` in `data/manifests/dbrip_v1.yaml`). It is not hardcoded in the schema. To switch the DB to a different assembly:

1. Produce a new CSV with coordinates in the target assembly (liftover or new annotation)
2. Create or update the manifest: change `assembly: hg38` to `assembly: hs1`
3. Re-ingest: `python scripts/ingest.py --manifest data/manifests/dbrip_v2.yaml`
4. Rebuild the track hub: `python scripts/build_trackhub.py --assemblies hs1 ...`

### Hardcoded hg38 defaults that need updating

These places default to hg38 but accept other values. They don't break if you switch assemblies, but the defaults would return empty results if the DB no longer contains hg38 data.

| Location | Default | What to change |
|----------|---------|----------------|
| `cli/dbrip.py` `--assembly` option | `hg38` | Change default or pass `--assembly hs1` when using `--region` |
| `build_trackhub.py` `--assemblies` flag | `["hg38"]` | Pass `--assemblies hs1` on the command line |
| `build_trackhub.py` assembly dispatch | `if assembly == "hg38"` / `elif assembly == "hg19"` | `build_hg38()` is actually assembly-agnostic (exports from API, sorts, converts). Rename/generalize if adding hs1. |
| Frontend region search | Uses `hg38` in the API path | Update to read assembly from the loaded dataset |
| CI workflow | Builds hg38 by default | Update `--assemblies` in the workflow file |

### Keeping both assemblies on the track hub

The DB only needs to hold one assembly (the primary one). Other assemblies can be built from supplementary coordinate files at track hub build time, the same way hg19 tracks are built from the lab's FASTA file rather than from the DB. If the lab switches to hs1, hg38 tracks could still be served by keeping an hg38 BED export or coordinate mapping file.

---

## Multi-dataset and multi-assembly limitations

The system is designed for one dataset in one assembly. Loading a second dataset or mixing assemblies works in some cases but has gaps.

### What works

- **Two datasets with different insertion IDs, same assembly**: both load fine. Use `--dataset-id` on list and export endpoints to isolate. `GET /v1/datasets` shows both.

### What breaks

| Scenario | Problem |
|----------|---------|
| Two datasets with overlapping IDs | `INSERT OR REPLACE` silently overwrites. The second load replaces rows from the first with no warning. `insertions.id` is the sole primary key. |
| Mixed assemblies in the DB | `/v1/insertions`, `/v1/export`, and `/v1/stats` have no `assembly` query parameter. Results mix both assemblies together. The track hub exports mixed coordinates into one bigBed. |
| Same insertion in two assemblies | Impossible. PK is `insertions.id`. You cannot store A0000001 in both hg38 and hs1. |

### Fix path (if multi-assembly becomes a real need)

1. **Add `assembly` as a filter to list/export/stats endpoints.** The column already exists in the DB and is returned in every API response. It just isn't accepted as a query parameter. This is the highest-impact, lowest-effort fix (~50 lines across 5 files, no schema change).
2. **Add `&assembly={assembly}` to the track hub export URL** in `build_trackhub.py` so each assembly's bigBed only contains its own coordinates.
3. **Add ID collision warning to `ingest.py`** before upsert: check if incoming IDs already exist under a different `dataset_id`.
4. **Composite PK** (`(id, assembly)` or `(id, dataset_id)`): only needed if the same insertion must exist in two assemblies simultaneously. This is a schema migration affecting models.py, ingest.py SQL, pop_frequencies FK, and every query that filters by ID.

---

## Key invariants to maintain

| Rule | Where to check |
|------|---------------|
| Pop column count | `POP_GROUPS` arrays in `filters.ts` must sum to the same number as `population_columns` in the manifest |
| Pop codes match the DB | `POPULATIONS` values and `POP_GROUPS` entries must use the exact strings stored in `pop_frequencies.population` |
| `column_map` covers every column | `data/manifests/dbrip_v1.yaml` |
| ORM schema matches ingest schema | `app/models.py` column names must match the `CREATE TABLE` SQL in `scripts/ingest.py` |
| CSV is source of truth | Never edit the SQLite DB directly. Always re-run `scripts/ingest.py` |

---

## File reference

### Backend

| File | Purpose |
|------|---------|
| `data/manifests/dbrip_v1.yaml` | CSV format description: column map, population columns, loader class |
| `ingest/base.py` | Abstract base class defining the 4-step ETL contract |
| `ingest/dbrip.py` | dbRIP-specific loader. The only file that knows the CSV shape. |
| `scripts/ingest.py` | Standalone CLI. The only way to write to the database. |
| `scripts/build_trackhub.py` | Standalone CLI. Builds UCSC Track Hub from the running API. |
| `app/models.py` | SQLAlchemy ORM models (3 tables) |
| `app/schemas.py` | Pydantic response schemas (JSON shapes) |
| `app/database.py` | DB engine + session factory |
| `app/routers/insertions.py` | Main search/filter endpoints |
| `app/routers/export.py` | BED/VCF/CSV streaming export |
| `app/routers/stats.py` | Aggregation endpoint |
| `app/routers/datasets.py` | Dataset registry endpoint |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/api/client.ts` | Typed fetch wrappers for all API endpoints |
| `frontend/src/hooks/useInsertions.ts` | TanStack Query hooks |
| `frontend/src/types/insertion.ts` | TypeScript interfaces matching Pydantic schemas |
| `frontend/src/constants/filters.ts` | Single source of truth for dropdown options |
| `frontend/src/components/DataTable.tsx` | Generic table with dual interaction modes |
| `frontend/src/pages/InteractiveSearch.tsx` | Main search tab + PopFreqTable |
| `frontend/src/pages/FileSearch.tsx` | BED/CSV/TSV upload + overlap results |
| `frontend/src/pages/BatchSearch.tsx` | Checkbox filters |
| `frontend/src/pages/IgvViewer.tsx` | Embedded genome browser |
| `frontend/src/utils/genomeBrowserHelpers.ts` | Pure functions for IGV/UCSC URL building |

### Config and CI

| File | Purpose |
|------|---------|
| `data/hub/templates/` | UCSC Track Hub config templates |
| `pyproject.toml` | Python dependencies and optional groups |
| `.github/workflows/build-trackhub.yml` | CI: hub + frontend build and deploy to GitHub Pages |
| `.github/workflows/docker.yml` | CI: test + Docker build |

### Tests

| File | What it tests |
|------|--------------|
| `tests/fixtures/sample.csv` | Small subset of the real CSV with edge cases (null TSD, null annotation) |
| `tests/test_ingest.py` | ETL: row counts, column renaming, population melt, null preservation |
| `tests/test_api.py` | Endpoints: filters, pagination, export formats, 404s/400s |
| `tests/test_build_trackhub.py` | Hub pipeline: template rendering, FASTA parsing, BED output, tool detection |
| `tests/test_cli.py` | CLI commands |
