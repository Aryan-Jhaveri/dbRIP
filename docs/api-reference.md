# API Reference

All endpoints are **read-only** (GET only). The API returns JSON unless you use the export endpoint.

Base URL: `http://localhost:8000` (or wherever you deploy it).

---

## Health Check

### `GET /v1/health`

Returns `{"status": "ok"}` if the server is running. Useful for monitoring and Docker health checks.

```bash
curl http://localhost:8000/v1/health
```

```json
{"status": "ok"}
```

---

## Insertions

### `GET /v1/insertions`

List insertions with optional filters and pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `me_type` | string | — | TE family: `ALU`, `LINE1`, `SVA`, `HERVK`. Comma-separate for OR: `me_type=ALU,SVA` |
| `me_subtype` | string | — | TE subfamily, e.g. `AluYa5`, `AluYb8` (exact match) |
| `me_category` | string | — | `Reference` or `Non-reference`. Comma-separate for multiple. |
| `variant_class` | string | — | `Common`, `Intermediate`, `Rare`, `Very Rare`. Comma-separate for multiple. |
| `annotation` | string | — | Genomic context: `INTRONIC`, `INTERGENIC`, `EXON`, `PROMOTER`, `5_UTR`, `3_UTR`, `TERMINATOR`. Comma-separate for multiple. |
| `dataset_id` | string | — | Filter by dataset source, e.g. `dbrip_v1` |
| `population` | string | — | Population code: `EUR`, `AFR`, `EAS`, `SAS`, `AMR`, `ACB`, `ASW`, `BEB`, `CDX`, `CEU`, `CHB`, `CHS`, `CLM`, `ESN`, `FIN`, `GBR`, `GIH`, `GWD`, `IBS`, `ITU`, `JPT`, `KHV`, `LWK`, `MSL`, `MXL`, `PEL`, `PJL`, `PUR`, `STU`, `TSI`, `YRI`, `Non_African`, `All` |
| `min_freq` | float | — | Minimum allele frequency (requires `population`) |
| `max_freq` | float | — | Maximum allele frequency (requires `population`) |
| `strand` | string | — | Strand: `+` or `-`. URL-encode `+` as `%2B`. Comma-separate for multiple: `strand=%2B,-`. Use `null` to match rows with no strand value. |
| `chrom` | string | — | Chromosome, e.g. `chr1`. Comma-separate for multiple: `chrom=chr1,chrX` |
| `search` | string | — | Free-text search across id, chrom, me_type, me_category, rip_type, me_subtype, annotation, variant_class (server-side LIKE, case-insensitive) |
| `limit` | int | 50 | Page size (1–1000) |
| `offset` | int | 0 | Pagination offset |

All filter params use AND logic. Providing multiple filters narrows the results. Comma-separated values within a single param use OR logic for that field.

**Example:**

```bash
curl "http://localhost:8000/v1/insertions?me_type=ALU&variant_class=Common&limit=3"
```

```json
{
  "total": 8234,
  "limit": 3,
  "offset": 0,
  "results": [
    {
      "id": "A0000042",
      "dataset_id": "dbrip_v1",
      "assembly": "hg38",
      "chrom": "chr1",
      "start": 1234567,
      "end": 1234568,
      "strand": "+",
      "me_category": "Non-reference",
      "me_type": "ALU",
      "rip_type": "Non-reference",
      "me_subtype": "AluYa5",
      "me_length": 281,
      "tsd": "AAAAGAAATGAAT",
      "annotation": "INTRONIC",
      "variant_class": "Common"
    }
  ]
}
```

---

### `GET /v1/insertions/{id}`

Get a single insertion by ID, including all 33 population frequencies.

**Example:**

```bash
curl http://localhost:8000/v1/insertions/A0000001
```

```json
{
  "id": "A0000001",
  "chrom": "chr1",
  "start": 758508,
  "end": 758509,
  "me_type": "ALU",
  "me_subtype": "AluYc1",
  "variant_class": "Very Rare",
  "populations": [
    {"population": "All", "af": 0.0002},
    {"population": "EUR", "af": 0.0},
    {"population": "AFR", "af": 0.0028},
    {"population": "EAS", "af": 0.0},
    {"population": "SAS", "af": 0.0}
  ]
}
```

Returns **404** if the insertion ID doesn't exist.

---

### `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}`

Query insertions in a genomic region. Supports the same filters as `/v1/insertions`.

**Path Parameters:**

| Param | Example | Description |
|-------|---------|-------------|
| `assembly` | `hg38` | Genome assembly |
| `chrom` | `chr1` | Chromosome |
| `start` | `1000000` | Start position (1-based) |
| `end` | `5000000` | End position (1-based) |

**Example:**

```bash
# All insertions on chr1 between 1Mb and 5Mb
curl "http://localhost:8000/v1/insertions/region/hg38/chr1:1000000-5000000"

# Only ALU insertions in that region
curl "http://localhost:8000/v1/insertions/region/hg38/chr1:1000000-5000000?me_type=ALU"

# Common ALU insertions in Europeans
curl "http://localhost:8000/v1/insertions/region/hg38/chr1:1000000-5000000?me_type=ALU&population=EUR&min_freq=0.05"
```

Returns **400** if the region format is invalid.

---

## Export

### `GET /v1/export`

Download insertions as BED, VCF, or CSV files. Supports the same filters as `/v1/insertions`.

**Query Parameters:**

| Param | Values | Description |
|-------|--------|-------------|
| `format` | `bed`, `vcf`, `csv` | Output format (default: `bed`) |
| *(all insertion filters)* | — | Same filters as `/v1/insertions` |

**Formats:**

| Format | Coordinates | Use case |
|--------|-------------|----------|
| BED6 | 0-based (converted from DB's 1-based) | bedtools, UCSC Genome Browser |
| VCF 4.2 | 1-based (same as DB) | Variant callers, genome browsers |
| CSV | 1-based | Spreadsheets, custom scripts |

**Examples:**

```bash
# Export all ALU insertions as BED
curl "http://localhost:8000/v1/export?format=bed&me_type=ALU" -o alu.bed

# Export common LINE1 as VCF
curl "http://localhost:8000/v1/export?format=vcf&me_type=LINE1&variant_class=Common" -o l1.vcf

# Export everything as CSV
curl "http://localhost:8000/v1/export?format=csv" -o all.csv
```

!!! note "Coordinate conversion"
    The database stores 1-based coordinates (matching the source CSV). BED format requires 0-based, so the export converts: `bed_start = db_start - 1`. VCF and CSV use 1-based and need no conversion.

---

## Stats

### `GET /v1/stats`

Summary counts grouped by a field. The database does the counting (SQL GROUP BY), so this is fast even on the full dataset.

**Query Parameters:**

| Param | Values | Default |
|-------|--------|---------|
| `by` | `me_type`, `me_subtype`, `me_category`, `chrom`, `variant_class`, `annotation`, `dataset_id` | `me_type` |

**Example:**

```bash
curl "http://localhost:8000/v1/stats?by=me_type"
```

```json
{
  "group_by": "me_type",
  "entries": [
    {"label": "ALU", "count": 33709},
    {"label": "LINE1", "count": 6468},
    {"label": "SVA", "count": 4697},
    {"label": "HERVK", "count": 101}
  ]
}
```

```bash
# Counts by chromosome
curl "http://localhost:8000/v1/stats?by=chrom"

# Counts by variant class
curl "http://localhost:8000/v1/stats?by=variant_class"
```

Returns **400** if the `by` field is not in the allowed list.

---

## Datasets

### `GET /v1/datasets`

List all loaded datasets with metadata.

```bash
curl http://localhost:8000/v1/datasets
```

```json
[
  {
    "id": "dbrip_v1",
    "version": "1.0",
    "label": "dbRIP — Database of Retrotransposon Insertion Polymorphisms",
    "source_url": "https://lianglab.shinyapps.io/shinydbRIP/",
    "assembly": "hg38",
    "row_count": 44984,
    "loaded_at": "2024-03-11T12:00:00"
  }
]
```

### `GET /v1/datasets/{id}`

Get a single dataset's details. Returns **404** if not found.

---

## Error Responses

All errors return JSON with a `detail` field:

```json
{"detail": "Insertion FAKE123 not found"}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (invalid region format, invalid export format, invalid group_by field) |
| 404 | Resource not found (insertion ID, dataset ID) |
| 500 | Server error |
