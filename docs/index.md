# dbRIP API

A read-only REST API for querying the [dbRIP database](https://lianglab.shinyapps.io/shinydbRIP/) of **retrotransposon insertion polymorphisms** — 44,984 TE insertions across 33 populations from the 1000 Genomes Project.

## What Can You Do With It?

- **Search** insertions by genomic region, TE family, population frequency, and more
- **Export** results as BED, VCF, or CSV for use with bedtools, genome browsers, or custom pipelines
- **Get statistics** — counts by TE type, chromosome, variant class, or annotation
- **Use the CLI** to query from the terminal and pipe results into other tools
- **Build on top of it** — the API returns JSON, so any language or tool can consume it

## Who Is This For?

- **Bioinformaticians** who want to query TE insertions programmatically
- **Lab members** who need to extract subsets of the data for analysis
- **Tool builders** who want to integrate dbRIP data into pipelines or web apps

## Quick Example

```bash
# Search for ALU insertions on chromosome 1
curl "http://localhost:8000/v1/insertions?me_type=ALU&limit=5"

# Or use the CLI
dbrip search --me-type ALU --limit 5

# Export LINE1 insertions as BED for bedtools
dbrip export --format bed --me-type LINE1 | bedtools intersect -a - -b peaks.bed
```

## How It Works

```
  data/raw/dbRIP_all.csv        ← Source CSV (44,984 rows, 47 columns)
        │
        ▼
  scripts/ingest.py             ← Load CSV into SQLite (run once)
        │
        ▼
  dbrip.sqlite                  ← Database (3 tables)
        │
        ▼
  app/ (FastAPI)                ← REST API (7 endpoints)
        │
        ▼
  JSON / BED / VCF / CSV       ← Query results
```

The CSV is the source of truth. The database is always rebuildable. The API is read-only.

## Next Steps

- **Setup** — see the [README](https://github.com/liang-lab/dbRIP#readme) for installation, data loading, and running the server
- [API Reference](api-reference.md) — all endpoints with examples
- [CLI Tool](cli.md) — terminal-based querying
- [Biology Background](biology.md) — what are transposable elements?
