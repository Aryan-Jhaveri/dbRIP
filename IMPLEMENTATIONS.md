# Next Steps — What to Build on Top of the API

The core API is working: ingest pipeline, database, 7 endpoints, 39 tests.
Below are the next things to build, roughly in priority order.

---

## 1. MCP Server — Let Claude Query the Database

**What:** An [MCP server](https://modelcontextprotocol.io/) that wraps the API so Claude can query
the database in natural language during a conversation.

**Why:** A researcher could ask Claude "Are there common Alu insertions near
BRCA2 in Africans?" and Claude would automatically call the API, get real data,
and answer with actual numbers.

**Where:** `mcp/server.py`

**How it would work:**
```python
from mcp.server.fastmcp import FastMCP
import httpx

mcp = FastMCP("dbRIP")
BASE = "http://localhost:8000/v1"

@mcp.tool()
def search_insertions(chrom: str, start: int, end: int,
                      me_type: str | None = None,
                      population: str | None = None,
                      min_freq: float | None = None) -> list[dict]:
    """Search TE insertions in a genomic region with optional filters."""
    params = {k: v for k, v in locals().items() if v is not None}
    r = httpx.get(f"{BASE}/insertions/region/hg38/{chrom}:{start}-{end}", params=params)
    return r.json()["results"]

@mcp.tool()
def get_insertion(id: str) -> dict:
    """Get full details for a single insertion by ID."""
    return httpx.get(f"{BASE}/insertions/{id}").json()

@mcp.tool()
def get_stats(by: str = "me_type") -> dict:
    """Summary stats grouped by me_type, population, chrom, or variant_class."""
    return httpx.get(f"{BASE}/stats", params={"by": by}).json()
```

**Dependencies:** `pip install mcp httpx`

**To register with Claude Desktop:** Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "dbrip": {
      "command": "python",
      "args": ["mcp/server.py"],
      "cwd": "/path/to/dbRIP-API"
    }
  }
}
```

**Effort:** Small — the API already does the heavy lifting, the MCP server just wraps it.

---

## 2. CLI Tool — `dbrip` Command

**What:** A command-line tool so researchers can query the API from the terminal
and pipe results into bedtools, awk, etc.

**Where:** `cli/dbrip.py`

**Example usage:**
```bash
# Search a region, output as BED
dbrip search -r chr1:1M-5M --me-type ALU --format bed

# Get a single insertion
dbrip get A0000001

# Export all LINE1 as VCF
dbrip export --format vcf --me-type LINE1 -o l1.vcf

# Stats
dbrip stats --by population

# Pipe into bedtools
dbrip search -r chr7:1M-50M --format bed | bedtools intersect -a - -b peaks.bed
```

**Stack:** [Typer](https://typer.tiangolo.com/) (CLI framework) + httpx (HTTP client).

**Configuration:** API base URL from `DBRIP_API_URL` env var or `~/.dbrip/config.toml`.

**Distribution:** Add a `[project.scripts]` entry in `pyproject.toml`:
```toml
[project.scripts]
dbrip = "cli.dbrip:app"
```

Then `pip install -e .` makes `dbrip` available as a command.

**Effort:** Medium — needs argument parsing, output formatting, error handling.

---

## 3. Documentation Site

**What:** Hosted API documentation beyond the auto-generated `/docs`.

**Options:**

### Option A: Use FastAPI's built-in docs (already done)
- `/docs` — Swagger UI (interactive, try-it-out)
- `/redoc` — ReDoc (cleaner, read-only)
- These are generated automatically from the endpoint definitions. Zero extra work.

### Option B: MkDocs site with examples
- Write a `docs/` directory with Markdown files
- Include example queries, biology context, population descriptions
- Host on GitHub Pages or ReadTheDocs
- Good for non-technical users who need context beyond "here's the API spec"

**Stack:** [MkDocs](https://www.mkdocs.org/) + [Material theme](https://squidfunnel.github.io/mkdocs-material/)

**Effort:** Medium — the API docs already exist, this is about adding tutorials and context.

---

## 4. Web Frontend

**What:** A browser-based interface for researchers who don't want to write code.

**Options:**

### Option A: Simple search page
- Single-page app with a search form
- Region input, ME type dropdown, population selector, frequency sliders
- Results table with export buttons
- Minimal — could be built with vanilla HTML/JS or React

### Option B: Genome browser integration
- Embed a genome browser (like [IGV.js](https://github.com/igvteam/igv.js) or [Gosling](https://gosling-lang.org/))
- Show insertions as tracks on the genome
- Click an insertion to see details and population frequencies
- More complex but much more useful for researchers

### Option C: Shiny app (R)
- Replace the existing Shiny dbRIP app with one backed by this API
- Familiar to the lab, easy for R users to modify
- Could use the API directly via `httr` or `httr2`

**Stack considerations:**
- The API already handles CORS (`allow_origins=["*"]`), so any frontend can talk to it
- The API returns JSON, which all frontend frameworks can consume
- Export endpoints return files directly — frontend just needs download links

**Effort:** Large — depends heavily on which option and how polished it needs to be.

---

## 5. Docker Deployment

**What:** Containerize the API for deployment on a server, cloud, or shared lab machine.

**Files:** `Dockerfile` + `docker-compose.yml` (already skeleton files in the repo)

**Architecture:**
```
docker-compose.yml
├── db         (postgres:16-alpine)     ← production database
├── api        (FastAPI + uvicorn)      ← the API server
└── migrate    (alembic upgrade head)   ← runs once on startup
```

**For SQLite-only deployment** (simpler, no PostgreSQL):
```dockerfile
FROM python:3.13-slim
COPY . /app
WORKDIR /app
RUN pip install .
# Pre-load the data
RUN python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Effort:** Small for SQLite-only, medium for full PostgreSQL + Alembic setup.

---

## 6. Additional Datasets

**What:** Load other TE databases alongside dbRIP.

**How:** The manifest + loader pattern makes this straightforward:
1. Drop the new CSV in `data/raw/`
2. Write a new manifest YAML in `data/manifests/`
3. Write a new loader class (inherits from `BaseLoader`)
4. Run `python scripts/ingest.py --manifest data/manifests/new_dataset.yaml`

**Potential datasets:**
- [euL1db](https://www.euL1db.icm.unicamp.br/) — LINE1 insertions in humans
- [TEMPOseq](https://github.com/WashU-BRG/TEMPOseq) — TE expression data
- Custom lab datasets

**Each dataset gets its own `dataset_id`**, so queries can filter by source:
`/v1/insertions?dataset_id=eul1db_v1`

---

## 7. Enrichment / Annotation Extensions

**What:** Add biological context to insertions — gene names, OMIM disease links,
GTEx expression data, Evo2 conservation scores.

**Where:** Extension tables in the database (already sketched in the API design doc):
```sql
CREATE TABLE enrichment (
    insertion_id  TEXT PRIMARY KEY REFERENCES insertions(id),
    gene_name     TEXT,
    gene_id       TEXT,
    evo2_score    REAL,
    omim_ids      TEXT[],
    gtex_egene    TEXT
);
```

**How:** A new ingest script (e.g. `scripts/enrich.py`) that:
1. Reads insertions from the DB
2. Looks up each position in a gene annotation file (GTF)
3. Cross-references with OMIM, GTEx, etc.
4. Writes to the `enrichment` table

**New endpoint:** `GET /v1/insertions/{id}/enrichment`

**Effort:** Large — requires downloading and parsing external data sources.

---

## 8. Liftover (hg19 / CHM13 coordinates)

**What:** Provide alternate coordinates for each insertion in hg19 and CHM13 assemblies.

**Where:** `coordinates_liftover` table (already sketched in the design doc):
```sql
CREATE TABLE coordinates_liftover (
    insertion_id  TEXT REFERENCES insertions(id),
    assembly      TEXT,    -- "hg19" or "CHM13"
    chrom         TEXT,
    start         INTEGER,
    end           INTEGER,
    method        TEXT,    -- "UCSC liftOver" or "T2T tools"
    UNIQUE (insertion_id, assembly)
);
```

**How:** Use UCSC `liftOver` tool with chain files. A script would:
1. Export insertions as BED (using the API's export endpoint)
2. Run `liftOver` to convert hg38 → hg19 and hg38 → CHM13
3. Load the results into the `coordinates_liftover` table

**New endpoint:** Region queries would accept `assembly=hg19` and automatically use the lifted coordinates.

**Effort:** Medium — the tool exists, the challenge is handling unmapped regions.

---

## Suggested Priority

| Priority | What | Why |
|----------|------|-----|
| 1 | Docker (SQLite-only) | Makes it deployable immediately |
| 2 | MCP Server | High-value, low-effort — Claude can query real data |
| 3 | CLI tool | Researchers use the terminal daily |
| 4 | Additional datasets | Multiplies the value of everything above |
| 5 | Web frontend | Useful but big effort — FastAPI `/docs` works for now |
| 6 | Enrichment | High scientific value but requires external data work |
| 7 | Liftover | Important for cross-assembly analysis |
| 8 | PostgreSQL + Alembic | Only needed when scale demands it |
