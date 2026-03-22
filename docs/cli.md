# CLI Tool

The `dbrip` command lets you query the API from the terminal and pipe results into tools like `bedtools`, `awk`, and `grep`.

## Installation

The CLI is installed automatically with the package:

```bash
pip install -e .
dbrip --help
```

## Configuration

By default, the CLI connects to `http://localhost:8000`. To point it at a different server:

```bash
export DBRIP_API_URL=https://dbrip.example.com
```

!!! note "The API server must be running"
    The CLI sends HTTP requests to the API. It does not query the database directly. Make sure the API is running (`uvicorn app.main:app --reload`) before using the CLI.

---

## Commands

### `dbrip search`

Search insertions with optional filters. Without `--region`, searches the entire database. With `--region`, searches a specific genomic region.

```bash
# Search for ALU insertions
dbrip search --me-type ALU --limit 10

# Region query with K/M shorthand
dbrip search --region chr1:1M-5M --me-type ALU

# Filter by population frequency
dbrip search --population EUR --min-freq 0.1 --variant-class Common

# JSON output (machine-readable)
dbrip search --me-type ALU --output json
```

**Region shorthand:** You can use `K` (thousands) and `M` (millions) in region coordinates:

| Input | Expands to |
|-------|-----------|
| `chr1:1M-5M` | `chr1:1000000-5000000` |
| `chr7:500K-1M` | `chr7:500000-1000000` |
| `chr1:1.5M-2M` | `chr1:1500000-2000000` |

**Options:**

| Flag | Description |
|------|-------------|
| `--region`, `-r` | Genomic region (e.g. `chr1:1M-5M`) |
| `--assembly`, `-a` | Genome assembly used with `--region` (default: `hg38`) |
| `--me-type` | TE family: `ALU`, `LINE1`, `SVA`, `HERVK`. Comma-separate for multiple: `ALU,SVA` |
| `--me-subtype` | TE subfamily (e.g. `AluYa5`) |
| `--me-category` | `Reference` or `Non-reference` |
| `--variant-class` | `Common`, `Intermediate`, `Rare`, `Very Rare` |
| `--annotation` | Genomic context: `INTRONIC`, `EXON`, `PROMOTER`, `5_UTR`, `3_UTR`, `INTERGENIC`, `TERMINATOR` |
| `--dataset-id` | Filter by dataset source, e.g. `dbrip_v1` |
| `--population`, `-p` | Population code (e.g. `EUR`, `AFR`, `EAS`, `SAS`, `AMR`) |
| `--min-freq` | Minimum allele frequency (requires `--population`) |
| `--max-freq` | Maximum allele frequency (requires `--population`) |
| `--limit`, `-l` | Number of results (default: 50, max: 1000) |
| `--offset` | Pagination offset |
| `--output`, `-o` | `table` (default) or `json` |

---

### `dbrip get`

Get full details for a single insertion, including all 33 population frequencies.

```bash
dbrip get A0000001

dbrip get A0000001 --output json
```

---

### `dbrip export`

Export insertions as BED, VCF, or CSV. Writes to stdout by default (pipe-friendly), or to a file with `--out`.

```bash
# Export ALU insertions as BED
dbrip export --format bed --me-type ALU -o alu.bed

# Export as VCF with frequency filter
dbrip export --format vcf --population EUR --min-freq 0.1

# Pipe directly into bedtools
dbrip export --format bed --me-type LINE1 | bedtools intersect -a - -b peaks.bed

# Export everything as CSV
dbrip export --format csv -o all_insertions.csv
```

**Options:**

| Flag | Description |
|------|-------------|
| `--format`, `-f` | `bed` (default), `vcf`, or `csv`. BED is 0-based; VCF and CSV are 1-based. |
| `--out`, `-o` | Output file path (defaults to stdout) |
| `--dataset-id` | Filter by dataset source, e.g. `dbrip_v1` |
| *(all other filter flags)* | Same as `dbrip search`: `--me-type`, `--me-category`, `--variant-class`, `--annotation`, `--population`, `--min-freq`, `--max-freq` |

---

### `dbrip stats`

Show summary counts grouped by a field.

```bash
# Default: group by ME type
dbrip stats

# Group by chromosome
dbrip stats --by chrom

# Group by variant class, JSON output
dbrip stats --by variant_class --output json
```

**Options:**

| Flag | Description |
|------|-------------|
| `--by`, `-b` | Field to group by: `me_type`, `chrom`, `variant_class`, `annotation`, `me_category`, `dataset_id` |
| `--output`, `-o` | `table` (default) or `json` |

---

### `dbrip datasets`

List all loaded datasets.

```bash
dbrip datasets

dbrip datasets --output json
```

---

## Piping and Scripting

The CLI is designed to work well in pipelines. When stdout is piped (not a terminal), rich formatting is automatically disabled.

```bash
# Count ALU insertions per chromosome
dbrip export --format bed --me-type ALU | cut -f1 | sort | uniq -c | sort -rn

# Find insertions near a gene
dbrip export --format bed | bedtools intersect -a - -b gene_regions.bed

# Get all insertion IDs matching a filter
dbrip search --me-type SVA --output json | jq -r '.results[].id'

# Batch lookup
for id in A0000001 A0000002 A0000003; do
    dbrip get "$id" --output json >> results.jsonl
done
```
