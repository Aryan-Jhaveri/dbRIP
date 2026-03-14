# dbRIP API

Read-only database of 44,984 retrotransposon insertion polymorphisms across 33 populations from the 1000 Genomes Project.

GitHub: https://github.com/Aryan-Jhaveri/dbRIP
Currently hosted at: https://dbrip-api.onrender.com/

---

## Components

The project ships as four independent components. Install only what you need:

| Component | What it is | How to get it |
|-----------|-----------|---------------|
| **CLI** | `dbrip` terminal tool — search, export, stats | `pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"` |
| **MCP** | Claude connector — query the DB in natural language | Claude Desktop config (no install) |
| **API** | FastAPI backend + REST endpoints | `pip install "dbrip-api[api] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"` |
| **Frontend** | React web app (6 tabs, IGV viewer) | Served by the API; built into the Docker image |
| **Full stack** | Everything above, one container | `docker run` or Render blueprint |

All components default to `http://localhost:8000` and work the same way whether running locally or against a remote server — just swap the URL. Currently also hosted at `https://dbrip-api.onrender.com` (replace `localhost` references below with that to skip local setup).

---

## CLI

Most lab members only need this. No cloning required — installs straight from GitHub.

**1. Install**
```bash
pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"
```

This installs the `dbrip` command and its two dependencies (`typer`, `httpx`). Nothing else from the repo is pulled in.

**2. Point it at a server**
```bash
# Use the hosted instance (no local setup needed):
export DBRIP_API_URL=https://dbrip-api.onrender.com

# Or a local instance if you're running the API yourself:
export DBRIP_API_URL=http://localhost:8000
```

Add the `export` line to `~/.bashrc` or `~/.zshrc` to make it permanent.

**3. Verify**
```bash
dbrip datasets   # should print dbrip_v1 with row_count 44984
```

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

Query the database in natural language from Claude Desktop. Ask things like:
- *"Are there common ALU insertions near BRCA2 in African populations?"*
- *"How many LINE1 insertions are intronic vs. intergenic?"*
- *"What's the population frequency breakdown for insertion A0012345?"*

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dbrip": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3001/mcp"]
    }
  }
}
```

`npx mcp-remote` is a stdio-to-HTTP bridge that Claude Desktop requires; it's auto-installed on first run. Restart Claude Desktop after saving the config.

The MCP server must be running locally (`cd mcp && npm start`) — or replace `localhost:3001` with the hosted MCP URL (`https://dbrip-mcp.onrender.com/mcp`) to skip local setup.

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
