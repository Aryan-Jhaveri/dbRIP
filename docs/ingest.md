# Ingest Pipeline

## Overview

ETL = Extract, Transform, Load.

```
Extract   -> read the CSV as-is (pandas)
Transform -> rename columns, cast types, melt population columns
Load      -> write to DB (drop + recreate tables, bulk insert)
```

The ingest pipeline has two parts:

1. **`ingest/`** - Python classes that know how to parse specific CSV formats
2. **`scripts/ingest.py`** - standalone CLI that orchestrates the load

The separation exists so the API never needs to know anything about CSV formats. Adding a new dataset means writing a new manifest YAML and a new loader class. Nothing else changes.

---

## The manifest

File: `data/manifests/dbrip_v1.yaml`

The manifest describes the CSV so the ingest pipeline knows how to parse it. Three key sections:

- `column_map` maps CSV column headers to database field names (e.g. `Chromosome` becomes `chrom`)
- `population_columns` lists the 33 population frequency columns that get melted from wide to long
- `loader_class` points to the Python class that implements the parsing logic

```yaml
id: dbrip_v1
version: "1.0"
label: "dbRIP - Database of Retrotransposon Insertion Polymorphisms"
source_url: "https://lianglab.shinyapps.io/shinydbRIP/"
assembly: hg38
coordinate_basis: 1-based
csv_path: data/raw/dbRIP_all.csv
loader_class: ingest.dbrip.DbRIPLoader

column_map:
  ID: id
  Chromosome: chrom
  Start: start
  End: end
  ME_category: me_category
  # ... (13 columns total)

null_strings: ["null", "NULL", "", "None"]

population_columns:
  individual: [ACB, ASW, BEB, CDX, CEU, CHB, CHS, CLM, ESN, FIN, GBR, GIH, GWD,
               IBS, ITU, JPT, KHV, LWK, MSL, MXL, PEL, PJL, PUR, STU, TSI, YRI]
  super:      [AFR, AMR, EAS, EUR, SAS, Non_African, All]
```

The manifest is stored in the database alongside the data so you can always see exactly how a dataset was loaded.

---

## The loader pattern

### Template Method (base class)

Every loader follows the same 4-step flow defined in `ingest/base.py`:

```python
class BaseLoader(ABC):
    def run(self):
        df = self.load_raw()              # Step 1: read CSV as-is
        df = self.normalize(df)            # Step 2: rename columns, cast types
        insertions = self.to_insertions(df)       # Step 3: pick metadata columns
        pop_freqs = self.to_pop_frequencies(df)   # Step 4: melt population columns
        return insertions, pop_freqs
```

Subclasses fill in the four abstract methods. The `run()` method is never overridden. This guarantees every loader follows the same flow regardless of the CSV format.

### DbRIPLoader (ingest/dbrip.py)

The only file that knows the shape of the dbRIP CSV.

- `load_raw()`: reads the CSV with `pd.read_csv()`, skips the R-generated row index column
- `normalize()`: renames columns using `column_map`, casts coordinates to `Int64` and frequencies to `float`
- `to_insertions()`: picks the 13 insertion columns, tags each row with `dataset_id` and `assembly`
- `to_pop_frequencies()`: uses `pd.melt()` to reshape population columns from wide to long format

### Adding a new dataset

To load a different TE database (e.g. euL1db):

1. Write `data/manifests/eul1db_v1.yaml` describing the new CSV format
2. Write `ingest/eul1db.py` implementing `BaseLoader` for the new CSV shape
3. Run `python scripts/ingest.py --manifest data/manifests/eul1db_v1.yaml`

No changes to the API, frontend, or existing loader.

---

## The ingest script

File: `scripts/ingest.py`

Standalone CLI. The only way to write to the database.

1. Reads the manifest YAML
2. Dynamically imports the loader class specified in `loader_class`
3. Calls `loader.run()` to get `(insertions, pop_frequencies)` as lists of dicts
4. Drops and recreates all tables, then bulk-inserts rows

### Commands

```bash
# Full ingest (drops and recreates all tables)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

# Dry run (validates the CSV without writing anything)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run

# Override CSV path (e.g. for a corrections file)
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --csv data/raw/corrections.csv

# Check what is currently loaded
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --status

# Use a different database file
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --db prod.sqlite
```

---

## Data update patterns

### Full refresh (new CSV export)

Drop the new CSV in `data/raw/`, run the load script:

```bash
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
```

### Patch a few rows (corrections CSV)

Make a CSV with only the changed rows (same column names, same IDs):

```bash
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml \
                         --csv data/raw/corrections_march.csv
```

### Fix one row directly in SQL

For bioinformaticians comfortable with SQL:

```sql
UPDATE insertions SET annotation = 'INTRONIC' WHERE id = 'A0000001';
```

This works for quick fixes but the change will be lost on the next full ingest. To make it permanent, edit the source CSV and re-ingest.

### Remove a dataset

```sql
DELETE FROM dataset_registry WHERE id = 'dbrip_v1';
```

Foreign keys cascade, so all insertions and pop_frequencies for that dataset are deleted too.
