# dbRIP Wiki

A read-only REST API for querying the [dbRIP database](https://lianglab.shinyapps.io/shinydbRIP/) of retrotransposon insertion polymorphisms across 33 populations from the 1000 Genomes Project (hg38).

| Service | URL |
|---------|-----|
| API + Web App | https://dbrip-api.onrender.com |
| Frontend (GitHub Pages) | https://aryan-jhaveri.github.io/dbRIP/ |
| UCSC Track Hub | [Load in UCSC](https://genome.ucsc.edu/cgi-bin/hgTracks?hubUrl=https://aryan-jhaveri.github.io/dbRIP/hub/hub.txt) |

## Pages

| Page | What it covers |
|------|---------------|
| [Getting Started](getting-started.md) | Setup, quick start, taking over the project |
| [Architecture](architecture.md) | How the programs connect, design rules, request flow |
| [Data and Schema](data.md) | The CSV, database tables, populations, coordinate systems |
| [Ingest Pipeline](ingest.md) | ETL design, manifest YAML, loaders, data updates |
| [API Reference](api-reference.md) | All endpoints, filters, response format, export |
| [Frontend](frontend.md) | React app, six tabs, DataTable, bulk actions |
| [Track Hub](track-hub.md) | UCSC Genome Browser integration, bigBed, build pipeline |
| [CLI](cli.md) | `dbrip` terminal tool for search, export, stats |
| [MCP](mcp.md) | Claude connector for natural-language queries |
| [Maintenance](maintenance.md) | Adding/renaming columns, data updates, known issues |
| [Deployment](deployment.md) | CI/CD, GitHub Pages, Render, forking |
| [Concepts](concepts.md) | TE biology, genomic coordinates, population genetics |

## Key facts

- Four TE families tracked: ALU, LINE1, SVA, HERVK
- 33 population columns (26 individual + 7 aggregate) from 1000 Genomes
- hg38 assembly, 1-based coordinates
- Run `dbrip stats` or `GET /v1/stats?by=me_type` to see current counts

## Access modes

| Mode | Description |
|------|-------------|
| REST API | JSON, BED6, VCF, CSV exports with filters and pagination |
| Web App | Six-tab React SPA with population frequency tables and IGV/UCSC export |
| CLI | `dbrip search`, `dbrip export`, `dbrip stats` from the terminal |
| MCP | Claude Desktop queries the database in natural language |
| UCSC Track Hub | Colored, searchable tracks in the UCSC Genome Browser |
