# What's Built / What's Next

## What's built

| Layer | Status |
|-------|--------|
| Ingest pipeline (CSV → SQLite) | Done |
| FastAPI backend (7 endpoints, 39 tests) | Done |
| CLI (`dbrip` — 5 commands, 21 tests) | Done |
| MkDocs documentation site | Done |
| React frontend (6 tabs: Interactive Search, File Search, Batch Search, IGV Viewer, API Reference, CLI Reference) | Done |
| Docker + Render deployment | Done |
| MCP server (`mcp/` — 5 tools, HTTP transport, `mcp-remote` bridge for Claude Desktop) | Done |

---

## Pending

### 1. Deploy the MCP server publicly

**What:** The MCP server in `mcp/` runs locally today. Deploying it to a public URL turns the Claude MCP connector from a local-dev feature into something any lab member can use by pointing Claude Desktop at a URL.

**How:** Deploy `mcp/` as a separate service on Render alongside the FastAPI backend. Set `DBRIP_API_URL` to the hosted API URL.

**Config after deployment** (replaces the localhost config in README):
```json
{
  "mcpServers": {
    "dbrip": {
      "command": "npx",
      "args": ["mcp-remote", "https://dbrip-mcp.onrender.com/mcp"]
    }
  }
}
```

**Effort:** Small — `mcp/` already has a `package.json` start script. Add a `render.yaml` service entry.

---

### 2. Column sort + filter dropdowns in DataTable

**What:** Clicking a column header sorts by that column (asc/desc toggle). Each column header also has a small dropdown to filter to a specific value (e.g. click ME Type header → dropdown showing ALU / LINE1 / SVA / HERVK / PP).

**Where:** `frontend/src/components/DataTable.tsx` + `frontend/src/pages/InteractiveSearch.tsx`

**How:** TanStack Table has built-in sorting state (`getSortedRowModel`) and column filter state (`getFilteredRowModel`). The sort state would be lifted to the parent and sent as query params to the API so sorting is server-side (same as search). Column filter dropdowns use `<select>` with the existing constants from `frontend/src/constants/filters.ts`.

**Effort:** Medium — needs API-side `sort_by` / `sort_order` params wired through the ORM query.

---

### 3. Manifest-driven frontend

**What:** Right now the frontend's table columns, filter dropdowns, and export fields are hardcoded TypeScript. When a second dataset with different columns is loaded, a developer has to update both the API models and the frontend components.

**How:**
1. Add `GET /v1/schema` — reads the loaded manifest and returns column names, types, and enum values:
   ```json
   {
     "columns": [
       { "name": "me_type", "type": "enum", "values": ["ALU", "LINE1", "SVA", "HERVK", "PP"] },
       { "name": "chrom",   "type": "string", "filterable": true },
       { "name": "start",   "type": "integer", "filterable": false }
     ]
   }
   ```
2. Frontend calls `GET /v1/schema` at startup via TanStack Query and builds its table columns + filter dropdowns from that response.

**When:** After the first second dataset is loaded. Until then the hardcoded approach is simpler.

**Effort:** Medium.

---

### 4. Additional datasets

**What:** Load other TE databases alongside dbRIP into the same SQLite instance.

**How:** The manifest + loader pattern makes this straightforward:
1. Drop the CSV in `data/raw/`
2. Write a manifest YAML in `data/manifests/`
3. Write a loader class inheriting `BaseLoader` in `ingest/`
4. Run `python scripts/ingest.py --manifest data/manifests/new_dataset.yaml`

Each dataset gets its own `dataset_id`; queries can filter by source with `?dataset_id=eul1db_v1`.

**Candidates:**
- [euL1db](https://www.euL1db.icm.unicamp.br/) — curated LINE1 insertions in the human genome
- Custom lab datasets

**Effort:** Small per dataset once the manifest format is understood; the loader pattern handles normalization.

---

### 5. Enrichment / annotation extensions

**What:** Add biological context to each insertion — nearest gene name, OMIM disease links, GTEx eGene associations.

**Where:** New `enrichment` table in the database:
```sql
CREATE TABLE enrichment (
    insertion_id  TEXT PRIMARY KEY REFERENCES insertions(id),
    gene_name     TEXT,
    gene_id       TEXT,
    omim_ids      TEXT,   -- comma-separated
    gtex_egene    TEXT
);
```

**How:** A new script `scripts/enrich.py` that reads insertions from the DB, looks up each position against a GTF annotation file, cross-references with OMIM / GTEx, and writes to `enrichment`. New endpoint: `GET /v1/insertions/{id}/enrichment`.

**Effort:** Large — requires downloading and parsing external data sources (Ensembl GTF, OMIM, GTEx).

---

### 6. Liftover (hg19 / CHM13 coordinates)

**What:** Alternate coordinates for each insertion in hg19 and CHM13 so users working in other assemblies can still query by position.

**Where:** New `coordinates_liftover` table:
```sql
CREATE TABLE coordinates_liftover (
    insertion_id  TEXT REFERENCES insertions(id),
    assembly      TEXT,    -- "hg19" or "CHM13"
    chrom         TEXT,
    start         INTEGER,
    end           INTEGER,
    method        TEXT,    -- "UCSC liftOver"
    UNIQUE (insertion_id, assembly)
);
```

**How:** Script exports insertions as BED → runs UCSC `liftOver` with the relevant chain files → loads lifted coordinates back into the DB. Region queries would then accept `?assembly=hg19` and use the lifted coordinates automatically.

**Effort:** Medium — the `liftOver` tool exists; the challenge is handling insertions that don't map cleanly.

---

## Priority order

| # | What | Effort |
|---|------|--------|
| 1 | Deploy MCP server publicly | Small |
| 2 | Column sort + filter dropdowns | Medium |
| 3 | Additional datasets (euL1db) | Small per dataset |
| 4 | Manifest-driven frontend | Medium (after 2nd dataset) |
| 5 | Enrichment / annotations | Large |
| 6 | Liftover (hg19/CHM13) | Medium |
