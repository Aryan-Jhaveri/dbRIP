# Data and Schema

## The source CSV

File: `data/raw/dbRIP_all.csv`

Each row is one transposable element insertion at a specific genomic location. The CSV has metadata columns (ID, coordinates, TE classification) and population frequency columns (allele frequencies from 1000 Genomes).

### Metadata columns

| CSV Header | DB Column | What it is |
|------------|-----------|-----------|
| `ID` | `id` | Primary key (e.g. `A0000001` for ALU, `L0000001` for LINE1) |
| `Chromosome` | `chrom` | `chr1` through `chrY` plus alt contigs |
| `Start` | `start` | 1-based start position |
| `End` | `end` | 1-based end position |
| `ME_category` | `me_category` | `Non-reference` or `Reference` |
| `ME_type` | `me_type` | `ALU`, `LINE1`, `SVA`, `HERVK` |
| `RIP_type` | `rip_type` | `NonLTR_SINE`, `NonLTR_LINE`, etc. |
| `ME_subtype` | `me_subtype` | Subfamily (e.g. `AluYa5`, `L1Ta`, `SVA`) |
| `ME_length` | `me_length` | Length in base pairs |
| `Strand` | `strand` | `+` or `-` (some rows have no strand value) |
| `TSD` | `tsd` | Target site duplication sequence (many rows NULL) |
| `Annotation` | `annotation` | `INTERGENIC`, `INTRONIC`, `EXON`, `PROMOTER`, etc. (some NULL) |
| `Variant_Class` | `variant_class` | `Very Rare`, `Rare`, `Low Frequency`, `Common` |

### Missing data

Some columns have NULL values in the source CSV. These are preserved exactly as-is per the "no data cleaning" rule.

- `tsd`: approximately 20% of rows
- `annotation`: approximately 12% of rows
- `strand`: several hundred rows

Run `python scripts/ingest.py --dry-run` to see current counts.

### Population frequency columns

33 columns representing allele frequencies (0 to 1) from the 1000 Genomes Project:

```
Super-populations -> individual populations
---------------------------------------------
AFR (African)      ACB  ASW  ESN  GWD  LWK  MSL  YRI
EUR (European)     CEU  FIN  GBR  IBS  TSI
EAS (East Asian)   CHB  CHS  CDX  JPT  KHV
SAS (South Asian)  BEB  GIH  ITU  PJL  STU
AMR (Am. Admixed)  CLM  MXL  PEL  PUR
---------------------------------------------
Aggregates:  All   Non_African
```

26 individual populations + 5 super-populations + 2 aggregates = 33 total.

### Variant class thresholds

Derived from the global allele frequency (`All` column):

| Class | Range |
|-------|-------|
| Very Rare | All < 0.01 |
| Rare | 0.01 to 0.05 |
| Low Frequency | 0.05 to 0.10 |
| Common | All > 0.10 |

---

## Database schema

The ingest pipeline creates three tables in SQLite (dev) or PostgreSQL (prod).

### `dataset_registry`

Tracks which datasets are loaded. One row per dataset.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | e.g. `dbrip_v1` |
| `version` | TEXT | e.g. `1.0` |
| `label` | TEXT | Human-readable name |
| `source_url` | TEXT | Where the data came from |
| `assembly` | TEXT | e.g. `hg38` |
| `manifest` | TEXT | Full manifest YAML stored as JSON for reproducibility |
| `row_count` | INTEGER | How many insertions were loaded |
| `loaded_at` | TEXT | ISO timestamp of last load |

### `insertions`

One row per TE insertion. This is the main table.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | dbRIP ID (e.g. `A0000001`) |
| `dataset_id` | TEXT FK | References `dataset_registry.id` (cascades on delete) |
| `assembly` | TEXT | `hg38` |
| `chrom` | TEXT | Chromosome name |
| `start` | INTEGER | 1-based start (as in source CSV) |
| `end` | INTEGER | 1-based end |
| `strand` | TEXT | `+`, `-`, or NULL |
| `me_category` | TEXT | `Non-reference` or `Reference` |
| `me_type` | TEXT | `ALU`, `LINE1`, `SVA`, `HERVK` |
| `rip_type` | TEXT | TE classification string |
| `me_subtype` | TEXT | Subfamily |
| `me_length` | INTEGER | Length in bp |
| `tsd` | TEXT | Target site duplication (nullable) |
| `annotation` | TEXT | Genomic context (nullable) |
| `variant_class` | TEXT | Frequency class |

**Indexes:**

- `idx_ins_region` on `(assembly, chrom, start, end)` for region queries
- `idx_ins_type` on `me_type` for TE family filtering
- `idx_ins_dataset` on `dataset_id` for dataset-scoped queries

### `pop_frequencies`

Population allele frequencies in long format. During ingest, the 33 wide columns in the CSV get melted into this table: one row per insertion per population.

| Column | Type | Description |
|--------|------|-------------|
| `insertion_id` | TEXT PK/FK | References `insertions.id` (cascades on delete) |
| `population` | TEXT PK | Population code (e.g. `EUR`, `ACB`, `All`) |
| `dataset_id` | TEXT FK | References `dataset_registry.id` |
| `af` | FLOAT | Allele frequency, 0 to 1 |

Composite primary key: `(insertion_id, population)`.

**Indexes:**

- `idx_popfreq_ins` on `insertion_id` for looking up all populations for one insertion
- `idx_popfreq_pop` on `(population, af)` for filtering by population and frequency

### Why long format?

The CSV stores frequencies as 33 wide columns. The database melts them into rows. This makes queries simpler:

```sql
-- Wide format (hard to query dynamically):
SELECT * FROM insertions WHERE EUR > 0.1;   -- column name is a variable

-- Long format (one standard query pattern):
SELECT i.* FROM insertions i
JOIN pop_frequencies p ON p.insertion_id = i.id
WHERE p.population = 'EUR' AND p.af > 0.1;
```

Long format also makes it easy to add new populations: just add rows, no schema migration needed.

---

## Coordinate systems

The CSV uses **1-based** coordinates. Different tools use different systems:

```
DNA:      A  T  G  C  A
1-based:  1  2  3  4  5   <- VCF, GFF3, the CSV, UCSC display
0-based:  0  1  2  3  4   <- BED, Python strings, SAM/BAM
```

The database stores 1-based as-is. Conversion happens only at the export boundary:

```python
# BED export (0-based):
bed_start = db_start - 1   # 758508 -> 758507
bed_end   = db_end          # 758509 -> 758509

# VCF export (1-based): no conversion needed
```

---

## SQL examples

The database is directly accessible. Bioinformaticians can query it without going through the API.

```sql
-- Count by TE family
SELECT me_type, COUNT(*) FROM insertions GROUP BY me_type ORDER BY 2 DESC;

-- Insertions in a region
SELECT * FROM insertions
WHERE chrom = 'chr1' AND start BETWEEN 1000000 AND 5000000;

-- Common EUR insertions (requires join)
SELECT i.id, i.me_type, i.me_subtype, p.af
FROM insertions i
JOIN pop_frequencies p ON p.insertion_id = i.id
WHERE p.population = 'EUR' AND p.af > 0.10
ORDER BY p.af DESC;

-- Missing data audit
SELECT
  COUNT(*) FILTER (WHERE tsd IS NULL)        AS missing_tsd,
  COUNT(*) FILTER (WHERE annotation IS NULL) AS missing_annotation
FROM insertions;
```

From R:

```r
library(DBI)
con <- dbConnect(RPostgres::Postgres(), dbname = "dbrip", host = "localhost")

# Query
df <- dbGetQuery(con, "
  SELECT i.id, i.me_type, p.af
  FROM insertions i
  JOIN pop_frequencies p ON p.insertion_id = i.id
  WHERE p.population = 'EUR' AND p.af > 0.10
")

# Fix a row
dbExecute(con, "UPDATE insertions SET annotation = 'INTRONIC' WHERE id = 'A0000001'")
```
