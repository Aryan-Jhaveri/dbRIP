# Next Steps — What to Build on Top of the API

The core API is working: ingest pipeline, database, 7 endpoints, 60 tests (13 ingest + 26 API + 21 CLI).
Below are the next things to build, roughly in priority order.


## Pending

- [ ] **Pop-freq filters** — Interactive Search and Batch Search have no filters for the
  `pop_freq` table (filter insertions by population sample frequency). Need dropdowns in
  both tabs for selecting a population and a minimum frequency threshold.

- [ ] **Column header sort + filter dropdowns** — column headers in the data table should
  support click-to-sort and inline filter dropdowns (e.g., filter ME Type to just `ALU`
  directly from the column header).

- [ ] **Export enums** — add `FastAPI Enum` / `Literal` types to the export endpoint so
  `?format=` is restricted to `bed | vcf | csv` at the API level, not just in docs.

- [ ] **Strand enums** — consider:
  ```python
  class Strand(str, Enum):
      plus = "+"
      minus = "-"

  raw_strand = Strand.plus.value  # Returns "+"
  ```
  May be necessary if strand values in the CSV are inconsistent across rows.

- [ ] **Error handling docs** — document default fallback behavior for query parameters.
  If a caller omits `?` or provides no parameters, what does each endpoint return?
  Add clear docstrings and OpenAPI descriptions for each parameter's default.


## Done

- ✅ **Interactive search and filtering** — server-side `LIKE` across 8 columns with debounce.
  Fixed-value filters (ME Type, Category, Annotation) use `<select multiple>` → SQL `IN` clause.
  Population + min_freq filters wire directly to the API. No empty-page bug.

- ✅ **Row count description** — "Showing X to Y of Z entries" is dynamically computed from
  API `total`.

- ✅ **Row selection** — row-click highlights blue (`bg-blue-200`); shift+click for range;
  drag-to-select (hold and sweep) with auto select/deselect mode. Selected rows feed the
  "Copy N selected rows" button which fetches full detail (including pop freqs) and writes
  TSV to clipboard.

- ✅ **Jump to page** — "Go to:" input on the pagination bar.

- ✅ **MkDocs tab** — the frontend's Docs tab renders all four MkDocs pages
  (index, api-reference, cli, biology) fetched from the API.

- ✅ **File Search** — BED/CSV/TSV file upload, configurable window size, overlap query,
  and results table with download.

- ✅ **Pop freq inline expand** — population frequencies shown as a nested row below each
  data row when the user checks that row's checkbox. Header checkbox expands/collapses all
  rows on the current page. TanStack Query caches fetched detail by ID.

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

## 2. CLI Tool — DONE

**Status:** Complete. 5 commands (`search`, `get`, `export`, `stats`, `datasets`), 21 tests.

**Files:** `cli/__init__.py`, `cli/dbrip.py`, `tests/test_cli.py`

**Stack:** Typer + httpx. Thin HTTP wrapper — talks to the running API, no direct DB access.

**Features:**
- Region shorthand: `chr1:1M-5M` → `chr1:1000000-5000000`
- Output modes: `--output table` (rich tables) or `--output json` (pipe-friendly)
- Export to stdout or file: `dbrip export --format bed -o out.bed`
- Config via `DBRIP_API_URL` env var (default: `http://localhost:8000`)

**Usage:**
```bash
dbrip search --region chr1:1M-5M --me-type ALU
dbrip get A0000001
dbrip export --format vcf --me-type LINE1 -o l1.vcf
dbrip stats --by me_type
dbrip export --format bed | bedtools intersect -a - -b peaks.bed
```

---

## 3. Documentation Site — DONE

**Status:** Complete. MkDocs Material site with 4 pages.

**Files:** `mkdocs.yml`, `docs/index.md`, `docs/api-reference.md`, `docs/cli.md`, `docs/biology.md`

**What's covered:**
- `index.md` — landing page, links to README for setup
- `api-reference.md` — all endpoints with curl examples and sample JSON responses
- `cli.md` — full CLI usage with piping/scripting examples
- `biology.md` — TE families, populations, variant classes, coordinates (for new lab members)

**Built-in docs also available:**
- `/docs` — Swagger UI (interactive)
- `/redoc` — ReDoc (read-only)

**To serve locally:** `pip install mkdocs-material && mkdocs serve`

---

## 4. Web Frontend — DONE (core)

**Status:** Core complete. Vite + React + TypeScript + TanStack Table/Query + Tailwind.

**Files:** `frontend/src/`

**Features shipped:**
- Interactive Search: server-side search + 6 filter types + pagination + "Go to page" + Download CSV + Copy selected rows (TSV with pop freqs) + drag-to-select rows + inline pop freq expand via checkbox
- File Search: BED/CSV/TSV upload + window overlap + results table + download
- Batch Search: checkbox filters (ME type, category, annotation, strand, chrom) + download
- API Reference tab: renders MkDocs `api-reference.md` fetched from the API
- CLI Reference tab: quick-reference for all `dbrip` commands
- `DataTable` component: generic, reusable, two independent interaction systems (row-click = copy selection; checkbox = inline expand)

**Stack:** `frontend/` — `npm run dev` for local, `npx tsc --noEmit` to type-check.

**Remaining frontend work:**
- Column header sort + filter dropdowns
- Pop-freq filters in Interactive Search and Batch Search
- IGV.js genome browser (see § 6 below)
- Docker + FastAPI `StaticFiles` mount for single-process deployment

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

## 6. Genome Browser (igv.js)

**What:** Embed an interactive genome browser in a new "Genome Browser" tab so researchers
can visualize TE insertion positions directly in the web app, alongside tracks like RefSeq genes.

**Why:** Seeing an insertion in genomic context — surrounding genes, GC content, repeats — helps
researchers quickly assess biological significance without switching to a separate tool like UCSC
or IGV Desktop.

**Where:** New tab in `frontend/src/App.tsx` + new component `frontend/src/pages/GenomeBrowser.tsx`

**Install:**
```bash
cd frontend
npm install igv
```

**React integration pattern:**
```tsx
// GenomeBrowser.tsx
import { useRef, useEffect } from "react";
import igv from "igv";

export function GenomeBrowser({ locus }: { locus: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    igv.createBrowser(containerRef.current, {
      genome: "hg38",
      locus,               // e.g. "chr1:1,000,000-2,000,000"
      tracks: [
        {
          type: "annotation",
          name: "dbRIP Insertions",
          // Fetch insertions for the visible region from the API
          url: `/v1/insertions/region/hg38/${locus}?format=bed`,
          format: "bed",
        },
      ],
    });
  }, [locus]);

  return <div ref={containerRef} style={{ height: 500 }} />;
}
```

**Locus format:** `chr1:1,000,000-2,000,000` (commas optional; igv.js also accepts
`chr1:1000000-2000000`).

**Track data:** Use the existing `GET /v1/insertions/region/hg38/{chrom}:{start}-{end}` endpoint.
The response can be formatted as BED via `?format=bed` (already supported by the export router).

**Placement:** Add a 6th tab "Genome Browser" in `App.tsx` alongside the existing five tabs.

**Effort:** Small — one `npm install igv`, one new component `GenomeBrowser.tsx`, one new tab entry.

---

## 7. Manifest-Driven Frontend

**Goal:** If the CSV gains new columns (new annotation types, CHM13 coordinates, multi-assembly
support), only the YAML manifest should need to change — the frontend adapts automatically.

**Why this matters:** Right now, the frontend's table columns, filter dropdowns, and export fields
are hardcoded in TypeScript. Every time the lab adds a new dataset with different columns, a
developer has to update both the API models and the frontend components separately. This creates
frontend drift — the UI silently shows fewer columns than the API provides.

**How it would work:**
1. Add a `GET /v1/schema` endpoint that reads the loaded manifest and returns column names and types:
   ```json
   {
     "columns": [
       { "name": "id",      "type": "string",  "filterable": false },
       { "name": "chrom",   "type": "string",  "filterable": true  },
       { "name": "me_type", "type": "enum",    "values": ["ALU", "LINE1", "SVA"] },
       { "name": "start",   "type": "integer", "filterable": false }
     ]
   }
   ```
2. The frontend calls `GET /v1/schema` at startup via TanStack Query and builds its table columns,
   filter dropdowns, and export fields from that response instead of hardcoded TypeScript arrays.
3. When a new dataset with new columns is loaded, the frontend automatically shows the new columns
   and offers the new filter values — no TypeScript changes required.

**When to build:** After the first time a second dataset is loaded (e.g., euL1db). Until then,
the current hardcoded approach is simpler and less error-prone.

---

## 8. Additional Datasets

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

## 9. Enrichment / Annotation Extensions

**What:** Add biological context to insertions — gene names, OMIM disease links.

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

## 10. Liftover (hg19 / CHM13 coordinates)

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

**New endpoint:** Region queries would accept `assembly=hg19` and automatically use the
lifted coordinates.

**Effort:** Medium — the tool exists, the challenge is handling unmapped regions.

---

## Suggested Priority

| Priority | What | Status | Why |
|----------|------|--------|-----|
| 1 | Docker (SQLite-only) | Pending | Makes it deployable immediately |
| 2 | MCP Server | Pending | High-value, low-effort — Claude can query real data |
| 3 | CLI tool | Done — 5 commands, 21 tests | — |
| 4 | Web frontend | Done — core features shipped | — |
| 5 | Genome Browser (igv.js) | Pending (stretch) | Low-effort; useful for interactive exploration |
| 6 | Manifest-Driven Frontend | Pending (after 2nd dataset) | Future-proofs UI against schema changes |
| 7 | Additional datasets | Pending | Multiplies the value of everything above |
| 8 | Enrichment | Pending | High scientific value but requires external data work |
| 9 | Liftover | Pending | Important for cross-assembly analysis |
| 10 | PostgreSQL + Alembic | Pending | Only needed when scale demands it |
