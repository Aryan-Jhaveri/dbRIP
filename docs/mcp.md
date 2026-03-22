# MCP (Claude Connector)

## What it is

MCP (Model Context Protocol) lets Claude call your code as tools mid-conversation. The dbRIP MCP server wraps the API so Claude can query the database in natural language.

```
You: "Are there common Alu insertions near BRCA2 in Africans?"

Claude automatically calls:
  search_insertions(
    chrom="chr13", start=32315508, end=32400268,
    me_type="ALU", population="AFR", min_freq=0.10
  )

Returns real data from your DB. Claude answers with actual numbers.
```

The MCP server talks to the API. Claude never touches the database directly.

## Setup

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

The MCP server must be running locally (`cd mcp && npm start`) or replace `localhost:3001` with the hosted MCP URL.

## Starting the server

```bash
cd mcp
npm install   # first time
npm start     # starts on http://localhost:3001/mcp
```

## Available tools

| Tool | What it does |
|------|-------------|
| `list_datasets` | Confirm the database is loaded and get row counts |
| `get_stats` | Counts grouped by TE family, chromosome, variant class, etc. |
| `list_insertions` | Free-text search + filters across the full database |
| `search_by_region` | Find insertions overlapping a genomic region |
| `get_insertion` | Full record including all population frequencies |

## How it works

Each MCP tool is a thin wrapper around an API endpoint:

```python
@mcp.tool()
def search_insertions(
    chrom: str, start: int, end: int,
    me_type: str | None = None,
    population: str | None = None,
    min_freq: float | None = None,
) -> list[dict]:
    """Search TE insertions in a genomic region."""
    params = {k: v for k, v in locals().items()
              if v is not None and k not in ("chrom", "start", "end")}
    r = httpx.get(f"{BASE}/insertions/region/hg38/{chrom}:{start}-{end}", params=params)
    return r.json()["results"]
```

Claude sees the docstrings and parameter types. When it decides to call a tool, it sends structured arguments and gets structured JSON back.
