"""
dbrip — Command-line tool for querying the dbRIP API.

This is a thin wrapper around the dbRIP REST API. Every command builds query
parameters and sends an HTTP request to the running API server. It does NOT
access the database directly — the API handles all query logic.

WHY A THIN WRAPPER?
    - The API is the single source of truth for query logic
    - The CLI works against remote servers too (not just localhost)
    - No SQLAlchemy or database dependencies needed here
    - Adding a new API endpoint? Just add a new CLI command that calls it.

COMMANDS:
    dbrip search     Search insertions (list or region query)
    dbrip get        Get a single insertion by ID
    dbrip export     Download insertions as BED, VCF, or CSV
    dbrip stats      Summary counts grouped by a field
    dbrip datasets   List loaded datasets

CONFIGURATION:
    Set DBRIP_API_URL to point at a running API server:
        export DBRIP_API_URL=http://localhost:8000    (default)
        export DBRIP_API_URL=https://dbrip.example.com

USAGE EXAMPLES:
    dbrip search --region chr1:1M-5M --me-type ALU
    dbrip get A0000001
    dbrip export --format bed --me-type LINE1 -o line1.bed
    dbrip stats --by population
    dbrip search --region chr7:1M-50M --format bed | bedtools intersect -a - -b peaks.bed

HOW THIS FILE CONNECTS TO THE REST OF THE PROJECT:
    - Talks to app/ via HTTP (never imports app/ directly)
    - Registered as a console script in pyproject.toml:
        [project.scripts]
        dbrip = "cli.dbrip:app"
    - After `pip install -e .`, the `dbrip` command is available in your terminal
"""

import json
import os
import re
import sys
from typing import Optional

import httpx
import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

# ── App setup ────────────────────────────────────────────────────────────
#
# Typer creates a CLI app object. Each @app.command() decorator registers
# a subcommand (like `dbrip search`, `dbrip get`, etc.).
# rich_markup_mode="rich" lets us use [bold], [green], etc. in help text.

app = typer.Typer(
    name="dbrip",
    help="Query the dbRIP database of retrotransposon insertion polymorphisms.",
    rich_markup_mode="rich",
    no_args_is_help=True,
)

# Rich console for pretty-printing tables and panels.
# When stdout is piped (not a TTY), rich automatically disables colors
# and decorations, so output stays clean for awk/grep/bedtools.
console = Console()

# ── Color mappings ────────────────────────────────────────────────────────
#
# These map database values to rich style strings.
# Using the Okabe-Ito colorblind-safe palette (same as the track hub).
# rich styles: https://rich.readthedocs.io/en/stable/style.html

# ME type → rich style (bold + color)
ME_TYPE_STYLES: dict[str, str] = {
    "ALU":   "bold blue",
    "LINE1": "bold #D55E00",   # vermilion (Okabe-Ito)
    "SVA":   "bold #009E73",   # bluish green (Okabe-Ito)
    "HERVK": "bold #CC79A7",   # reddish purple (Okabe-Ito)
    "PP":    "bold #E69F00",   # orange (Okabe-Ito)
}

# Variant class → rich style
VARIANT_CLASS_STYLES: dict[str, str] = {
    "Common":  "green",
    "Rare":    "yellow",
    "Private": "red",
}


def _me_type_text(value: str | None) -> Text:
    """Wrap an ME type value in its Okabe-Ito color, or return plain text."""
    if not value:
        return Text("")
    style = ME_TYPE_STYLES.get(value, "")
    return Text(value, style=style)


def _variant_class_text(value: str | None) -> Text:
    """Color-code variant class (Common=green, Rare=yellow, Private=red)."""
    if not value:
        return Text("")
    style = VARIANT_CLASS_STYLES.get(value, "")
    return Text(value, style=style)


def _af_text(af: float | None) -> Text:
    """Format an allele frequency with a color based on its magnitude.

    Color scale (same thresholds used in population genetics literature):
        ≥ 0.50 → bold green  (common variant, majority of people carry it)
        ≥ 0.10 → green       (common variant)
        ≥ 0.01 → yellow      (rare variant)
        <  0.01 → dim        (very rare / private)
        None    → dim dash
    """
    if af is None:
        return Text("—", style="dim")
    formatted = f"{af:.4f}"
    if af >= 0.50:
        return Text(formatted, style="bold green")
    if af >= 0.10:
        return Text(formatted, style="green")
    if af >= 0.01:
        return Text(formatted, style="yellow")
    return Text(formatted, style="dim")


# ── Helpers ──────────────────────────────────────────────────────────────


def _base_url() -> str:
    """Get the API base URL from the environment, or fall back to localhost.

    Researchers can point the CLI at any running API instance:
        export DBRIP_API_URL=https://dbrip.example.com
    """
    return os.environ.get("DBRIP_API_URL", "http://localhost:8000").rstrip("/")


def _get(path: str, params: dict | None = None, status_msg: str = "Fetching…") -> dict:
    """Send a GET request to the API and return the JSON response.

    Shows a spinner while the request is in flight so the user knows
    something is happening (especially important on Render cold-starts
    which can take ~30 s). The spinner disappears automatically when
    the request completes.

    Args:
        path:       API path like "/v1/insertions"
        params:     Optional query parameters (None values are stripped)
        status_msg: Message shown next to the spinner
    """
    url = f"{_base_url()}{path}"

    # Strip None values so httpx doesn't send "?me_type=None"
    if params:
        params = {k: v for k, v in params.items() if v is not None}

    try:
        # console.status() shows a spinner and disappears when the `with` block exits.
        # It writes to stderr so stdout stays pipe-clean for BED/VCF output.
        with console.status(f"[dim]{status_msg}[/dim]", spinner="dots"):
            response = httpx.get(url, params=params, timeout=30.0)
    except httpx.ConnectError:
        console.print(
            Panel(
                f"Could not connect to the API at [bold]{_base_url()}[/bold]\n\n"
                "Is the server running? Start it with:\n"
                "  [cyan]uvicorn app.main:app --reload[/cyan]\n\n"
                "Or set [bold]DBRIP_API_URL[/bold] to point at a different server.",
                title="Connection Error",
                border_style="red",
                padding=(1, 2),
            )
        )
        raise typer.Exit(code=1)

    # If the API returned an error (4xx or 5xx), show the detail message
    if response.status_code >= 400:
        detail = response.json().get("detail", response.text)
        console.print(
            Panel(
                f"[bold]HTTP {response.status_code}[/bold] — {detail}",
                title="API Error",
                border_style="red",
                padding=(0, 2),
            )
        )
        raise typer.Exit(code=1)

    return response.json()


def _get_raw(path: str, params: dict | None = None) -> httpx.Response:
    """Send a GET request and return the raw response (for file downloads).

    Used by the export command where we need the response body as text,
    not parsed JSON. Shows a spinner while downloading.
    """
    url = f"{_base_url()}{path}"
    if params:
        params = {k: v for k, v in params.items() if v is not None}

    try:
        with console.status("[dim]Downloading…[/dim]", spinner="dots"):
            response = httpx.get(url, params=params, timeout=60.0)
    except httpx.ConnectError:
        console.print(
            Panel(
                f"Could not connect to the API at [bold]{_base_url()}[/bold]\n\n"
                "Is the server running? Start it with:\n"
                "  [cyan]uvicorn app.main:app --reload[/cyan]",
                title="Connection Error",
                border_style="red",
                padding=(1, 2),
            )
        )
        raise typer.Exit(code=1)

    if response.status_code >= 400:
        detail = response.json().get("detail", response.text)
        console.print(
            Panel(
                f"[bold]HTTP {response.status_code}[/bold] — {detail}",
                title="API Error",
                border_style="red",
                padding=(0, 2),
            )
        )
        raise typer.Exit(code=1)

    return response


def _parse_region_shorthand(value: str) -> str:
    """Convert region shorthands like chr1:1M-5M → chr1:1000000-5000000.

    Bioinformaticians commonly use M (mega) and K (kilo) suffixes when
    talking about genomic positions. This converts them to plain integers
    so the API can parse them.

    Examples:
        chr1:1M-5M     → chr1:1000000-5000000
        chr7:500K-1M   → chr7:500000-1000000
        chr1:100-200   → chr1:100-200  (no change)
    """
    def _expand(m: re.Match) -> str:
        """Replace a number+suffix with the expanded integer."""
        num = float(m.group(1))
        suffix = m.group(2).upper()
        multiplier = {"K": 1_000, "M": 1_000_000}[suffix]
        return str(int(num * multiplier))

    return re.sub(r"(\d+(?:\.\d+)?)\s*([KkMm])", _expand, value)


def _build_filters(
    me_type: str | None = None,
    me_subtype: str | None = None,
    me_category: str | None = None,
    variant_class: str | None = None,
    annotation: str | None = None,
    dataset_id: str | None = None,
    population: str | None = None,
    min_freq: float | None = None,
    max_freq: float | None = None,
    assembly: str | None = None,
) -> dict:
    """Build a query params dict from filter arguments, skipping None values.

    These filters are shared across search, export, and stats commands.
    Rather than repeating the dict construction in each command, this helper
    does it once.
    """
    return {
        "me_type": me_type,
        "me_subtype": me_subtype,
        "me_category": me_category,
        "variant_class": variant_class,
        "annotation": annotation,
        "dataset_id": dataset_id,
        "population": population,
        "min_freq": min_freq,
        "max_freq": max_freq,
        "assembly": assembly,
    }


# ── Commands ─────────────────────────────────────────────────────────────


@app.command()
def search(
    # ── Region filter ──
    region: Optional[str] = typer.Option(
        None, "--region", "-r",
        help="Genomic region, e.g. chr1:1M-5M. Supports K/M suffixes.",
    ),
    assembly: Optional[str] = typer.Option(
        None, "--assembly", "-a",
        help="Genome assembly (e.g. hg38, hs1). Used as region path param with --region, "
             "or as a filter param without --region. Defaults to hg38 for --region.",
    ),
    # ── Insertion filters ──
    me_type: Optional[str] = typer.Option(None, "--me-type", help="TE family (ALU, LINE1, SVA, HERVK)."),
    me_subtype: Optional[str] = typer.Option(None, "--me-subtype", help="TE subfamily (e.g. AluYa5)."),
    me_category: Optional[str] = typer.Option(None, "--me-category", help="Reference or Non-reference."),
    variant_class: Optional[str] = typer.Option(None, "--variant-class", help="Frequency class (Common, Rare, etc.)."),
    annotation: Optional[str] = typer.Option(None, "--annotation", help="Genomic context (INTRONIC, etc.)."),
    dataset_id: Optional[str] = typer.Option(None, "--dataset-id", help="Filter by dataset."),
    # ── Population filters ──
    population: Optional[str] = typer.Option(None, "--population", "-p", help="Population code (EUR, AFR, etc.)."),
    min_freq: Optional[float] = typer.Option(None, "--min-freq", help="Minimum allele frequency."),
    max_freq: Optional[float] = typer.Option(None, "--max-freq", help="Maximum allele frequency."),
    # ── Pagination ──
    limit: int = typer.Option(50, "--limit", "-l", help="Number of results (max 1000)."),
    offset: int = typer.Option(0, "--offset", help="Pagination offset."),
    # ── Output ──
    output: str = typer.Option("table", "--output", "-o", help="Output format: table or json."),
):
    """Search insertions with optional filters.

    Without --region, searches the entire database.
    With --region, searches a specific genomic region.

    [bold]Examples:[/bold]

        dbrip search --me-type ALU --limit 10

        dbrip search --region chr1:1M-5M --me-type ALU

        dbrip search --population EUR --min-freq 0.1 --output json
    """
    filters = _build_filters(
        me_type=me_type, me_subtype=me_subtype, me_category=me_category,
        variant_class=variant_class, annotation=annotation, dataset_id=dataset_id,
        population=population, min_freq=min_freq, max_freq=max_freq,
        assembly=assembly,
    )

    if region:
        parsed = _parse_region_shorthand(region)
        # Region endpoint uses assembly as a path parameter, not a query param.
        # Default to hg38 if not specified (region search requires an assembly).
        region_assembly = assembly or "hg38"
        path = f"/v1/insertions/region/{region_assembly}/{parsed}"
        status_msg = f"Searching {parsed}…"
        # Remove assembly from filters dict — it's already in the URL path
        filters.pop("assembly", None)
    else:
        path = "/v1/insertions"
        status_msg = "Searching…"

    params = {**filters, "limit": limit, "offset": offset}
    data = _get(path, params, status_msg=status_msg)

    if output == "json":
        typer.echo(json.dumps(data, indent=2))
        return

    results = data["results"]
    total = data["total"]

    if not results:
        console.print(Panel("[yellow]No insertions matched your filters.[/yellow]", padding=(0, 2)))
        return

    # Build the results table.
    # box.ROUNDED gives curved corners — cleaner than the default ASCII grid.
    table = Table(
        box=box.ROUNDED,
        show_header=True,
        header_style="bold",
        highlight=True,         # highlights the focused row in compatible terminals
        title=f"[bold]{total:,} insertions[/bold] · showing {offset + 1}–{offset + len(results)}",
        title_style="cyan",
        caption=f"API: {_base_url()}",
        caption_style="dim",
    )

    table.add_column("ID",            style="cyan",   no_wrap=True)
    table.add_column("Chrom",         no_wrap=True)
    table.add_column("Start",         justify="right", no_wrap=True)
    table.add_column("End",           justify="right", no_wrap=True)
    table.add_column("ME Type",       no_wrap=True)
    table.add_column("Subtype",       no_wrap=True)
    table.add_column("Category")
    table.add_column("Variant Class", no_wrap=True)
    table.add_column("Annotation")

    for r in results:
        table.add_row(
            r["id"],
            r["chrom"],
            f"{r['start']:,}",
            f"{r['end']:,}",
            _me_type_text(r.get("me_type")),
            r.get("me_subtype") or "",
            r.get("me_category") or "",
            _variant_class_text(r.get("variant_class")),
            r.get("annotation") or "",
        )

    console.print()
    console.print(table)

    # Pagination hint
    shown = offset + len(results)
    if shown < total:
        console.print(
            f"  [dim]Next page:[/dim]  dbrip search … --offset {shown} --limit {limit}",
        )
    console.print()


@app.command()
def get(
    insertion_id: str = typer.Argument(help="Insertion ID, e.g. A0000001."),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table or json."),
):
    """Get full details for a single insertion, including population frequencies.

    [bold]Examples:[/bold]

        dbrip get A0000001

        dbrip get A0000001 --output json
    """
    data = _get(f"/v1/insertions/{insertion_id}", status_msg=f"Fetching {insertion_id}…")

    if output == "json":
        typer.echo(json.dumps(data, indent=2))
        return

    # ── Metadata table (key-value layout inside a Panel) ──
    #
    # A two-column table (field | value) reads much better than a wall of
    # `console.print(f"  Key: {value}")` lines, especially when rendered
    # in a terminal with 80+ columns.

    meta = Table(box=box.SIMPLE, show_header=False, padding=(0, 1))
    meta.add_column("Field", style="dim", no_wrap=True)
    meta.add_column("Value")

    meta.add_row("Assembly",      data.get("assembly") or "")
    meta.add_row("Location",      f"{data['chrom']}:{data['start']:,}–{data['end']:,}")
    meta.add_row("Strand",        data.get("strand") or ".")
    meta.add_row("ME Type",       _me_type_text(data.get("me_type")))
    meta.add_row("ME Subtype",    data.get("me_subtype") or "")
    meta.add_row("ME Category",   data.get("me_category") or "")
    meta.add_row("RIP Type",      data.get("rip_type") or "")
    meta.add_row("ME Length",     str(data.get("me_length") or ""))
    meta.add_row("TSD",           data.get("tsd") or "")
    meta.add_row("Annotation",    data.get("annotation") or "")
    meta.add_row("Variant Class", _variant_class_text(data.get("variant_class")))
    meta.add_row("Dataset",       data.get("dataset_id") or "")

    console.print()
    console.print(
        Panel(
            meta,
            title=f"[bold cyan]{data['id']}[/bold cyan]",
            border_style="cyan",
            padding=(1, 2),
        )
    )

    # ── Population frequencies table ──
    populations = data.get("populations", [])
    if populations:
        freq_table = Table(
            box=box.ROUNDED,
            show_header=True,
            header_style="bold",
            title="Population Frequencies",
            title_style="dim",
        )
        freq_table.add_column("Population", style="cyan")
        freq_table.add_column("Allele Frequency", justify="right")

        for pop in populations:
            freq_table.add_row(pop["population"], _af_text(pop.get("af")))

        console.print(freq_table)

    console.print()


@app.command()
def export(
    # ── Format ──
    format: str = typer.Option("bed", "--format", "-f", help="Export format: bed, vcf, or csv."),
    # ── Output file ──
    out: Optional[str] = typer.Option(None, "--out", "-o", help="Output file path. Defaults to stdout."),
    # ── Insertion filters ──
    me_type: Optional[str] = typer.Option(None, "--me-type", help="TE family (ALU, LINE1, SVA, HERVK)."),
    me_subtype: Optional[str] = typer.Option(None, "--me-subtype", help="TE subfamily."),
    me_category: Optional[str] = typer.Option(None, "--me-category", help="Reference or Non-reference."),
    variant_class: Optional[str] = typer.Option(None, "--variant-class", help="Frequency class."),
    annotation: Optional[str] = typer.Option(None, "--annotation", help="Genomic context."),
    dataset_id: Optional[str] = typer.Option(None, "--dataset-id", help="Filter by dataset."),
    assembly: Optional[str] = typer.Option(None, "--assembly", "-a", help="Genome assembly (e.g. hg38, hs1)."),
    # ── Population filters ──
    population: Optional[str] = typer.Option(None, "--population", "-p", help="Population code."),
    min_freq: Optional[float] = typer.Option(None, "--min-freq", help="Minimum allele frequency."),
    max_freq: Optional[float] = typer.Option(None, "--max-freq", help="Maximum allele frequency."),
):
    """Export insertions as BED, VCF, or CSV.

    Writes to stdout by default (pipe-friendly), or to a file with --out.

    [bold]Examples:[/bold]

        dbrip export --format bed --me-type ALU -o alu.bed

        dbrip export --format vcf --population EUR --min-freq 0.1

        dbrip export --format bed | bedtools intersect -a - -b peaks.bed
    """
    filters = _build_filters(
        me_type=me_type, me_subtype=me_subtype, me_category=me_category,
        variant_class=variant_class, annotation=annotation, dataset_id=dataset_id,
        population=population, min_freq=min_freq, max_freq=max_freq,
        assembly=assembly,
    )
    params = {**filters, "format": format}

    response = _get_raw("/v1/export", params)
    content = response.text

    if out:
        with open(out, "w") as f:
            f.write(content)
        console.print(
            Panel(
                f"Saved [bold]{out}[/bold]  ({len(content.splitlines()):,} lines)",
                border_style="green",
                padding=(0, 2),
            )
        )
    else:
        # Write to stdout — no rich formatting so pipes (bedtools, awk) work cleanly
        sys.stdout.write(content)


@app.command()
def stats(
    by: str = typer.Option(
        "me_type", "--by", "-b",
        help="Field to group by: me_type, chrom, variant_class, annotation, me_category, dataset_id.",
    ),
    assembly: Optional[str] = typer.Option(None, "--assembly", "-a", help="Filter by genome assembly (e.g. hg38, hs1)."),
    dataset_id: Optional[str] = typer.Option(None, "--dataset-id", help="Filter by dataset."),
    output: str = typer.Option("table", "--output", "-o", help="Output format: table or json."),
):
    """Show summary counts grouped by a field.

    [bold]Examples:[/bold]

        dbrip stats

        dbrip stats --by chrom

        dbrip stats --by variant_class --output json

        dbrip stats --assembly hg38
    """
    params = {"by": by}
    if assembly:
        params["assembly"] = assembly
    if dataset_id:
        params["dataset_id"] = dataset_id
    data = _get("/v1/stats", params, status_msg=f"Counting by {by}…")

    if output == "json":
        typer.echo(json.dumps(data, indent=2))
        return

    entries = data["entries"]
    total = sum(e["count"] for e in entries)

    table = Table(
        box=box.ROUNDED,
        show_header=True,
        header_style="bold",
        title=f"Stats by [bold]{data['group_by']}[/bold]",
        title_style="cyan",
    )
    table.add_column("Label",   style="cyan")
    table.add_column("Count",   justify="right")
    table.add_column("% Total", justify="right", style="dim")

    for entry in entries:
        count = entry["count"]
        pct = f"{100 * count / total:.1f}%" if total else ""
        if by == "me_type":
            label_cell = _me_type_text(entry["label"])
        else:
            label_cell = entry["label"]
        table.add_row(label_cell, f"{count:,}", pct)

    console.print()
    console.print(table)
    console.print(f"  [dim]Total: {total:,}[/dim]\n")


@app.command()
def datasets(
    output: str = typer.Option("table", "--output", "-o", help="Output format: table or json."),
):
    """List all loaded datasets.

    Shows what datasets are in the database, when they were loaded,
    and how many rows each has.

    [bold]Examples:[/bold]

        dbrip datasets

        dbrip datasets --output json
    """
    data = _get("/v1/datasets", status_msg="Loading datasets…")

    if output == "json":
        typer.echo(json.dumps(data, indent=2))
        return

    if not data:
        console.print(Panel("[yellow]No datasets loaded.[/yellow]", padding=(0, 2)))
        return

    table = Table(
        box=box.ROUNDED,
        show_header=True,
        header_style="bold",
        title="Loaded Datasets",
        title_style="cyan",
    )
    table.add_column("ID",         style="cyan", no_wrap=True)
    table.add_column("Version",    no_wrap=True)
    table.add_column("Label")
    table.add_column("Assembly",   no_wrap=True)
    table.add_column("Rows",       justify="right")
    table.add_column("Loaded At",  no_wrap=True)

    for ds in data:
        row_count = ds.get("row_count")
        table.add_row(
            ds["id"],
            ds.get("version") or "",
            ds.get("label") or "",
            ds.get("assembly") or "",
            f"{row_count:,}" if row_count else "",
            ds.get("loaded_at") or "",
        )

    console.print()
    console.print(table)
    console.print()


# ── Entry point ──────────────────────────────────────────────────────────
#
# This lets you run the CLI directly with `python cli/dbrip.py` during
# development, or as `dbrip` after installing with `pip install -e .`.

if __name__ == "__main__":
    app()
