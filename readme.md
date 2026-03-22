# dbRIP

The [dbRIP database](https://lianglab.shinyapps.io/shinydbRIP/) (Liang Lab, Brock University) catalogs 44,984 transposable element insertion polymorphisms: positions in the human genome where a mobile DNA element (ALU, LINE1, SVA, HERVK) is present in some individuals but absent in others. Allele frequencies are provided across 33 populations from the 1000 Genomes Project (hg38).

This repo wraps that dataset in a read-only REST API, a React web app, a CLI, a UCSC Genome Browser track hub, and a Claude MCP connector. The database is always rebuildable from a single CSV file in `data/raw/`. Pushing an updated CSV to `main` is all it takes to propagate new data through the API, frontend, and track hub.

| Service | URL |
|---------|-----|
| API + Web App | https://dbrip-api.onrender.com |
| Frontend (GitHub Pages) | https://aryan-jhaveri.github.io/dbRIP/ |
| UCSC Track Hub | [Load in UCSC](https://genome.ucsc.edu/cgi-bin/hgTracks?hubUrl=https://aryan-jhaveri.github.io/dbRIP/hub/hub.txt) |

> When the lab forks this repo, GitHub Pages URLs update automatically. The API URL is set via `API_BASE_URL` in `.github/workflows/build-trackhub.yml`.

---

## Components

| Component | Description | Install / Access |
|-----------|-------------|------------------|
| **CLI** | `dbrip` terminal tool: search, export, stats | `pip install "dbrip-api[cli] @ git+..."` (see below) |
| **Web App** | Six-tab React interface with IGV viewer and population frequency tables | Served at the API root, or via GitHub Pages |
| **MCP** | Query the database in natural language from Claude Desktop | Config snippet below |
| **API** | FastAPI backend with REST endpoints (JSON, BED, VCF, CSV) | `pip install "dbrip-api[api] @ git+..."` or Docker |
| **Track Hub** | UCSC Genome Browser tracks per ME family, colored and indexed | Built by CI, hosted on GitHub Pages |

---

## CLI

Most lab members only need this. No cloning required.

```bash
pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"
```

Point it at a server:

```bash
export DBRIP_API_URL=https://dbrip-api.onrender.com
```

Add that line to `~/.bashrc` or `~/.zshrc` to make it permanent. Then:

```bash
dbrip datasets                                    # check connection
dbrip search --region chr1:1M-5M --me-type ALU    # region + filter
dbrip get A0000001                                # full record
dbrip export --format bed --me-type LINE1 -o l1.bed
dbrip stats --by me_type
```

See [docs/cli.md](docs/cli.md) for all commands and flags.

---

## MCP (Claude connector)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

The MCP server runs locally (`cd mcp && npm start`) or replace `localhost:3001` with the hosted MCP URL to skip local setup. See [docs/mcp.md](docs/mcp.md) for available tools.

---

## UCSC Track Hub

Load the hub in UCSC Genome Browser via My Data > Track Hubs > My Hubs:

```
https://aryan-jhaveri.github.io/dbRIP/hub/hub.txt
```

Insertions are colored by ME family (ALU red, LINE1 blue, SVA green) and searchable by dbRIP ID. UCSC fetches only the visible region via HTTP byte-range requests against bigBed files built and hosted by CI.

> **Known data issue:** 132 rows in the source CSV have `End < Start`. These rows are queryable through the API and frontend but are excluded from the track hub, which requires `end > start`. See [docs/data.md](docs/data.md) for the full breakdown.

See [docs/track-hub.md](docs/track-hub.md) for the build pipeline and hub structure.

---

## Self-hosting

```bash
git clone https://github.com/Aryan-Jhaveri/dbRIP.git
cd dbRIP
docker build -t dbrip-api .
docker run -p 8000:8000 dbrip-api
```

Open `http://localhost:8000`. The image builds the frontend, loads the database, and starts the server in one step.

For cloud hosting, connect the repo to [Render](https://render.com) and create a new Blueprint. It detects `render.yaml` and configures both services automatically.

See [docs/deployment.md](docs/deployment.md) for cloud options and CI configuration.

---

## Development

Requires Python 3.11+ and Node.js 20+.

```bash
# Python backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[all,dev]"
python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml
uvicorn app.main:app --reload          # http://localhost:8000/docs

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173

# MCP server (separate terminal)
cd mcp && npm install && npm start         # http://localhost:3001/mcp

# Tests
pytest tests/ -v
```

See [docs/getting-started.md](docs/getting-started.md) for a full walkthrough.

---

## Documentation

The [wiki](docs/) covers all components in detail:

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Data and Schema](docs/data.md)
- [Ingest Pipeline](docs/ingest.md)
- [API Reference](docs/api-reference.md)
- [Frontend](docs/frontend.md)
- [Track Hub](docs/track-hub.md)
- [CLI](docs/cli.md)
- [MCP](docs/mcp.md)
- [Deployment](docs/deployment.md)
- [Maintenance](docs/maintenance.md)
