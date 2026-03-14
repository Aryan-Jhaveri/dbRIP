# dbRIP API

Read-only database of 44,984 retrotransposon insertion polymorphisms across 33 populations from the 1000 Genomes Project.

Hosted at: https://dbrip-api.onrender.com/

---

## Components

The project ships as four independent components. Install only what you need:

| Component | What it is | How to get it |
|-----------|-----------|---------------|
| **CLI** | `dbrip` terminal tool — search, export, stats | `pip install "dbrip-api[cli] @ git+..."` |
| **MCP** | Claude connector — query the DB in natural language | Claude Desktop config (no install) |
| **API** | FastAPI backend + REST endpoints | `pip install "dbrip-api[api] @ git+..."` |
| **Frontend** | React web app (6 tabs, IGV viewer) | Served by the API; built into the Docker image |
| **Full stack** | Everything above, one container | `docker run` or Render blueprint |

All components talk to the same hosted API at `https://dbrip-api.onrender.com/v1`. The CLI and MCP work out of the box against the hosted server — no local setup needed.

---

## CLI

Most lab members only need this. Install directly from GitHub — no cloning required:

```bash
pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"
export DBRIP_API_URL=https://dbrip-api.onrender.com
```

Add the `export` line to `~/.bashrc` or `~/.zshrc` to make it permanent.

```bash
# Search by region and TE type
dbrip search --region chr1:1M-5M --me-type ALU

# Get full details for one insertion
dbrip get A0000001

# Export to BED/VCF/CSV
dbrip export --format bed --me-type LINE1 -o line1.bed
dbrip export --format vcf | bgzip > insertions.vcf.gz

# Summary counts
dbrip stats --by me_type
dbrip stats --by population
```

Add `--output json` to any command for pipe-friendly JSON instead of a table.

---

## MCP (Claude connector)

Connect Claude Desktop to the live database — no local server needed. Ask things like:
- *"Are there common ALU insertions near BRCA2 in African populations?"*
- *"How many LINE1 insertions are intronic vs. intergenic?"*
- *"What's the population frequency breakdown for insertion A0012345?"*

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

`npx mcp-remote` is a stdio-to-HTTP bridge that Claude Desktop requires; it's auto-installed on first run. Restart Claude Desktop after saving the config.

**Tools available to Claude:**

| Tool | What it does |
|------|-------------|
| `list_datasets` | Confirm the database is loaded and get row counts |
| `get_stats` | Counts grouped by TE family, chromosome, variant class, annotation, etc. |
| `list_insertions` | Free-text search + filters across the full database |
| `search_by_region` | Find insertions overlapping a genomic region (chrom:start-end) |
| `get_insertion` | Full record for one insertion including all 33 population frequencies |

---

## Web App

Served at the same URL as the API. Six tabs:

- **Interactive Search** — search and filter all insertions, expand rows for population frequencies, copy selected rows as TSV, view in IGV
- **File Search** — upload a BED/CSV/TSV and find overlapping insertions within a configurable window
- **Batch Search** — filter by TE type, category, annotation, strand, and chromosome
- **IGV Viewer** — embedded genome browser; navigates automatically from Interactive Search
- **API Reference** — full endpoint documentation
- **CLI Reference** — quick-reference for all `dbrip` commands

---

## Self-hosting (full stack)

Run everything locally with Docker:

```bash
git clone https://github.com/Aryan-Jhaveri/dbRIP.git
cd dbRIP
docker build -t dbrip-api .
docker run -p 8000:8000 dbrip-api
```

Open `http://localhost:8000`. The image builds the frontend, loads the database, and starts the server in one step.

For cloud hosting, connect the repo to [Render](https://render.com) → New → Blueprint. It detects `render.yaml` and creates both services (`dbrip-api` + `dbrip-mcp`) automatically.

---

## Development

Requires Python 3.11+ and Node.js 22+.

```bash
# Python setup
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[all,dev]"
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
uvicorn app.main:app --reload          # → http://localhost:8000/docs

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # → http://localhost:5173

# MCP server (separate terminal)
cd mcp && npm install && npm start         # → http://localhost:3001/mcp

# Tests
pytest tests/ -v
```

For local Claude Desktop testing, point the MCP config at `http://localhost:3001/mcp` instead of the hosted URL.

### Project structure

```
data/raw/dbRIP_all.csv          ← source CSV (44,984 rows); DB is always rebuildable from this
data/manifests/dbrip_v1.yaml   ← describes the CSV format for the ingest pipeline

ingest/                         ← ETL pipeline (BaseLoader + dbRIP-specific loader)
scripts/ingest.py               ← CLI to load CSV into SQLite

app/                            ← FastAPI backend (read-only, 7 endpoints)
cli/dbrip.py                    ← CLI pack (Typer + httpx, talks to hosted API)
frontend/src/                   ← Frontend pack (Vite + React + TanStack + Tailwind + igv.js)
mcp/                            ← MCP pack (Express + @modelcontextprotocol/sdk, 5 tools)
tests/                          ← pytest suite (60 tests)
```

### API endpoints

Full interactive docs at `/docs`. Quick reference:

| Endpoint | Description |
|----------|-------------|
| `GET /v1/insertions` | List/search insertions |
| `GET /v1/insertions/{id}` | Single insertion with population frequencies |
| `GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}` | Region query |
| `GET /v1/export?format=bed\|vcf\|csv` | Export filtered results |
| `GET /v1/stats?by=me_type\|chrom\|variant_class` | Summary counts |
| `GET /v1/datasets` | Loaded dataset registry |

Common filter parameters: `me_type`, `me_subtype`, `me_category`, `variant_class`, `annotation`, `population`, `min_freq`, `max_freq`, `limit`, `offset`
