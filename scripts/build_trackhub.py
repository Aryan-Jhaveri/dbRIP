"""
scripts/build_trackhub.py — Build the dbRIP UCSC Track Hub.

This script is the full pipeline for producing a UCSC Track Hub from the
dbRIP database. Run it after `scripts/ingest.py` has loaded data into SQLite
and `uvicorn app.main:app` is serving the API.

WHAT THIS SCRIPT DOES:
    For each ME type (ALU, LINE1, SVA, ...):
        1. Calls GET /v1/export?format=bed&me_type=TYPE on the local API
        2. Sorts the BED file (chromosome + position order bedToBigBed needs)
        3. Fetches chromosome sizes from UCSC (once per assembly)
        4. Converts to bigBed binary format with bedToBigBed
    Then:
        5. Renders hub config templates (hub.txt, genomes.txt, trackDb.txt)
        6. Writes .build_meta.json recording what was built and when

WHY BIGBED INSTEAD OF PLAIN BED?
    The UCSC browser cannot read plain text BED files from a remote hub —
    it would have to download the whole file to display any region. bigBed
    is a sorted, indexed binary format that supports byte-range HTTP fetches,
    so UCSC only downloads the data visible in the current window.

USAGE:
    # Render templates only — no UCSC tools or BED download needed
    python scripts/build_trackhub.py \\
      --api-url http://localhost:8000 \\
      --hub-url https://aryan-jhaveri.github.io/dbRIP/hub \\
      --dry-run

    # Full build (requires bedToBigBed + fetchChromSizes on PATH)
    python scripts/build_trackhub.py \\
      --api-url http://localhost:8000 \\
      --hub-url https://aryan-jhaveri.github.io/dbRIP/hub

    # Build specific ME types
    python scripts/build_trackhub.py \\
      --api-url http://localhost:8000 \\
      --hub-url https://aryan-jhaveri.github.io/dbRIP/hub \\
      --me-types ALU LINE1 SVA

    # Also build hg19 tracks from the lab's FASTA (native coords, no liftOver)
    python scripts/build_trackhub.py \\
      --api-url http://localhost:8000 \\
      --hub-url https://aryan-jhaveri.github.io/dbRIP/hub \\
      --assemblies hg38 hg19 \\
      --hg19-fasta data/raw/HS-ME.hg19.fa

    # Check if hub is stale vs. current API data
    python scripts/build_trackhub.py --status

NOTE ON HUB URL:
    The --hub-url is the public HTTPS base URL where hub/ will be served.
    When the lab forks this repo to a permanent host, just update --hub-url
    in the CI workflow — no other changes needed.

INSTALL REQUIRED TOOLS:
    conda install -c bioconda ucsc-bedtobigbed ucsc-fetchchromsizes

    Or download static binaries (Linux x86_64):
    wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/bedToBigBed
    wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/fetchChromSizes
    chmod +x bedToBigBed fetchChromSizes

INSTALL PYTHON DEPENDENCY (httpx):
    pip install -e ".[trackhub]"   # or: pip install httpx
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# httpx provides streaming HTTP with a clean API.
# It streams the BED export response so we never load 44,984 rows into memory.
# Install: pip install httpx  (or pip install -e ".[trackhub]")
import httpx


# ── Constants ─────────────────────────────────────────────────────────────

# The project root is two directories up from this script (scripts/build_trackhub.py)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Templates live in data/hub/templates/ and are version-controlled in main.
# The build script reads them and writes rendered copies to hub/.
TEMPLATES_DIR = PROJECT_ROOT / "data" / "hub" / "templates"

# Color palette for UCSC track display.
# Colors are RGB strings ("R,G,B") — the format UCSC's trackDb expects.
# Any ME type not in this map gets the gray fallback.
ME_TYPE_COLORS: dict[str, str] = {
    "ALU":   "200,0,0",    # red
    "LINE1": "0,0,180",    # navy blue
    "SVA":   "0,150,0",    # forest green
    "HERVK": "150,0,150",  # purple
}
DEFAULT_COLOR = "100,100,100"  # gray — for any future ME type not listed above


# ── Tool detection ────────────────────────────────────────────────────────

def check_tools(dry_run: bool) -> bool:
    """Check that required UCSC command-line tools are on PATH.

    In dry-run mode the bigBed conversion is skipped entirely, so UCSC
    tools aren't needed. This lets you test template rendering anywhere.

    Returns True if all required tools are found, False otherwise
    (and prints instructions for installing any missing tool).
    """
    if dry_run:
        return True

    required = ["bedToBigBed", "fetchChromSizes"]
    missing = [t for t in required if not shutil.which(t)]

    if missing:
        print("ERROR: Required UCSC tools not found on PATH:")
        for tool in missing:
            print(f"  {tool}")
        print()
        print("Install via conda:")
        print("  conda install -c bioconda ucsc-bedtobigbed ucsc-fetchchromsizes")
        print()
        print("Or download static binaries (Linux x86_64, e.g. for CI):")
        print("  wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/bedToBigBed")
        print("  wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/fetchChromSizes")
        print("  chmod +x bedToBigBed fetchChromSizes")
        return False

    return True


# ── API helpers ───────────────────────────────────────────────────────────

def get_me_types_from_api(api_url: str) -> list[str]:
    """Ask the API which ME types are in the database.

    Calls GET /v1/stats?by=me_type and returns a list of label strings.
    This means if a new ME type is added to the CSV and re-ingested, the
    next hub build will automatically produce a sub-track for it.

    Exits with an error message if the API is unreachable.
    """
    url = f"{api_url.rstrip('/')}/v1/stats?by=me_type"
    print(f"  Auto-detecting ME types from API: {url}")

    try:
        response = httpx.get(url, timeout=30)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"\nERROR: Could not reach API at {url}")
        print(f"  {exc}")
        print("\nMake sure the API is running:")
        print("  uvicorn app.main:app --host 127.0.0.1 --port 8000")
        sys.exit(1)

    data = response.json()
    # Filter out "(null)" entries — rows with no me_type value in the DB
    types = [e["label"] for e in data["entries"] if e["label"] != "(null)"]
    print(f"  Found: {types}")
    return types


def get_row_counts_from_api(api_url: str) -> dict[str, int]:
    """Fetch the current insertion count per ME type from the API.

    Used by --status to detect whether the hub is stale relative to the DB.
    Returns an empty dict if the API is unreachable (caller handles this).
    """
    url = f"{api_url.rstrip('/')}/v1/stats?by=me_type"
    try:
        response = httpx.get(url, timeout=30)
        response.raise_for_status()
    except httpx.HTTPError:
        return {}

    data = response.json()
    return {e["label"]: e["count"] for e in data["entries"] if e["label"] != "(null)"}


def fetch_bed_to_file(api_url: str, me_type: str, output_path: Path, timeout: int = 120):
    """Download the BED6 export for one ME type to a local file.

    Uses HTTP streaming so we never hold all ~18,000+ ALU rows in memory
    at once. The 120s timeout is generous to allow for Render cold-starts
    (the free tier sleeps after inactivity; first request takes ~30s).
    """
    url = f"{api_url.rstrip('/')}/v1/export?format=bed&me_type={me_type}"
    print(f"    Downloading BED: {url}")

    try:
        with httpx.stream("GET", url, timeout=timeout) as response:
            response.raise_for_status()
            with open(output_path, "wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)
    except httpx.HTTPError as exc:
        print(f"\nERROR: BED export failed for {me_type}: {exc}")
        sys.exit(1)


# ── BED → bigBed pipeline ─────────────────────────────────────────────────

def filter_invalid_bed_rows(input_path: Path, output_path: Path) -> int:
    """Remove BED rows where end <= start (invalid for bedToBigBed).

    WHY THIS IS NEEDED:
    Some insertions in the source CSV have start > end. The project's "no data
    cleaning" rule means these are preserved in the database and API exports.
    But bedToBigBed rejects any row where end <= start, so we filter them out
    here and print a warning. The original data in the DB is not modified.

    Returns the number of dropped rows.
    """
    dropped = 0
    with open(input_path, encoding="utf-8") as f_in, \
         open(output_path, "w", encoding="utf-8") as f_out:
        for line in f_in:
            if not line.strip():
                continue
            cols = line.split("\t")
            if len(cols) >= 3:
                try:
                    start = int(cols[1])
                    end = int(cols[2])
                    if end <= start:
                        dropped += 1
                        continue
                except ValueError:
                    pass  # non-numeric — let bedToBigBed report its own error
            f_out.write(line)
    return dropped


def sort_bed(input_path: Path, output_path: Path):
    """Sort a BED file by chromosome then start position.

    WHY IS SORTING NEEDED?
    The API returns rows in Python's default string sort order:
        chr1, chr10, chr11, chr2, chr3, ...   (lexicographic)
    bedToBigBed requires all records for each chromosome to be contiguous
    and within each chromosome sorted numerically by start position.

    sort flags:
        -k1,1   sort by column 1 (chromosome name), lexicographic
        -k2,2n  then by column 2 (start position) as an integer

    LC_ALL=C ensures consistent byte-order sorting regardless of
    the system locale (important in CI environments).
    """
    print(f"    Sorting {input_path.name}")

    with open(output_path, "w") as out_f:
        result = subprocess.run(
            ["sort", "-k1,1", "-k2,2n", str(input_path)],
            stdout=out_f,
            stderr=subprocess.PIPE,
            text=True,
            env={**_clean_env(), "LC_ALL": "C"},
        )

    if result.returncode != 0:
        print(f"\nERROR: sort failed:\n{result.stderr}")
        sys.exit(1)


def _clean_env() -> dict[str, str]:
    """Return the current environment as a dict (for subprocess.run env= argument)."""
    import os
    return dict(os.environ)


def fetch_chrom_sizes(assembly: str, output_path: Path):
    """Download chromosome sizes for an assembly from UCSC's server.

    fetchChromSizes writes tab-separated (chrom, size) pairs to stdout.
    We redirect stdout to the output file. The file is cached per build —
    we fetch it once and reuse it for all ME types in that assembly.

    Example output line:
        chr1    248956422
    """
    print(f"    Fetching chrom sizes for {assembly} from UCSC")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        result = subprocess.run(
            ["fetchChromSizes", assembly],
            stdout=f,
            stderr=subprocess.PIPE,
            text=True,
        )

    if result.returncode != 0:
        print(f"\nERROR: fetchChromSizes failed for {assembly}:\n{result.stderr}")
        sys.exit(1)


def convert_to_bigbed(sorted_bed: Path, chrom_sizes: Path, output_bb: Path):
    """Convert a sorted BED6 file to bigBed binary format.

    bigBed is indexed so the UCSC browser can fetch only the rows
    that fall within the visible window via HTTP byte-range requests.
    Without this format, UCSC would have to download the entire file.

    bedToBigBed flags:
        -type=bed6   tells the tool we have exactly 6 columns (standard BED6)
                     No AutoSQL (-as) file is needed for the standard 6 columns.
    """
    print(f"    bedToBigBed → {output_bb.name}")
    output_bb.parent.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        ["bedToBigBed", "-type=bed6", str(sorted_bed), str(chrom_sizes), str(output_bb)],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"\nERROR: bedToBigBed failed:\n{result.stderr}")
        sys.exit(1)


# ── hg19 FASTA coordinate parsing ─────────────────────────────────────────

def parse_hg19_fasta(fasta_path: Path) -> dict[str, list[tuple]]:
    """Extract BED6 records from HS-ME.hg19.fa FASTA headers.

    The lab's supplementary FASTA file contains native hg19 coordinates
    for every dbRIP insertion encoded directly in the FASTA header line.
    This is better than liftOver because:
        - No chain file or liftOver binary needed
        - No unmapped entries (liftOver drops insertions in unmappable regions)
        - Coordinates are the lab's own authoritative hg19 positions

    FASTA HEADER FORMAT (pipe-delimited, > stripped):
        dbRIP_ID | OriginalID | Type | Chrom | Strand | f5 | f6 | f7 | f8 | f9 | Start | End | ...

    Field indices (0-based):
        [0]  = insertion ID  (e.g. A0000001)
        [2]  = ME type       (e.g. ALU, LINE1, SVA)
        [3]  = chromosome    (e.g. chr1)
        [4]  = strand        (+ or -)
        [10] = chrSs         (1-based start — convert to 0-based for BED)
        [11] = chrEs         (1-based end — keep as-is for BED half-open)

    BED is 0-based half-open: subtract 1 from start only.

    Returns:
        dict mapping ME type (uppercase) → list of (chrom, start, end, id, strand)
        tuples, where start is already 0-based (BED-ready).
    """
    records: dict[str, list[tuple]] = {}
    skipped = 0

    print(f"  Parsing FASTA headers: {fasta_path}")

    with open(fasta_path, encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            if not line.startswith(">"):
                continue  # skip sequence lines

            header = line[1:].strip()  # remove leading '>' and trailing newline
            fields = header.split("|")

            if len(fields) < 12:
                skipped += 1
                if skipped <= 5:  # only print the first few warnings
                    print(f"    WARNING: skipping malformed header (< 12 fields) "
                          f"at line {line_num}: {header[:60]}")
                continue

            try:
                ins_id   = fields[0].strip()
                me_type  = fields[2].strip().upper()  # normalize to uppercase
                chrom    = fields[3].strip()
                strand   = fields[4].strip() or "."
                start_1b = int(fields[10].strip())    # 1-based
                end      = int(fields[11].strip())    # BED end = same as 1-based end
            except (ValueError, IndexError) as exc:
                skipped += 1
                if skipped <= 5:
                    print(f"    WARNING: parse error at line {line_num} ({exc}): "
                          f"{header[:60]}")
                continue

            bed_start = start_1b - 1  # convert 1-based → 0-based

            if me_type not in records:
                records[me_type] = []
            records[me_type].append((chrom, bed_start, end, ins_id, strand))

    if skipped > 5:
        print(f"    WARNING: {skipped} malformed headers skipped in total")

    for me_type, entries in sorted(records.items()):
        print(f"    {me_type}: {len(entries):,} entries")

    return records


def write_bed_from_records(records: list[tuple], output_path: Path):
    """Write a list of (chrom, start, end, id, strand) tuples to a BED6 file.

    Each tuple becomes one tab-separated line. The score column is always 0
    (it has no meaning for our data but is required by the BED6 format).
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for chrom, start, end, ins_id, strand in records:
            f.write(f"{chrom}\t{start}\t{end}\t{ins_id}\t0\t{strand}\n")


# ── Template rendering ────────────────────────────────────────────────────

def _strip_comments(template_text: str) -> str:
    """Remove comment lines (starting with #) and blank lines from a template.

    The template files have comment blocks explaining the format for new RAs.
    When rendering to hub/, we strip those comments so the output files contain
    only the UCSC-format content.
    """
    lines = [
        line for line in template_text.splitlines()
        if not line.startswith("#") and line.strip()
    ]
    return "\n".join(lines)


def render_templates(
    output_dir: Path,
    assemblies: list[str],
    me_types: list[str],
    hub_url: str,
):
    """Write all hub configuration files from the template files.

    Templates live in data/hub/templates/ (version-controlled in main branch).
    Rendered output goes to hub/ (gitignored; deployed to gh-pages).

    Files produced:
        hub/hub.txt                     — entry point for UCSC
        hub/genomes.txt                 — one stanza per built assembly
        hub/{assembly}/trackDb.txt      — composite header + sub-tracks
        hub/{assembly}/dbRIP.html       — track description popup
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    hub_url = hub_url.rstrip("/")

    # ── hub.txt — copy as-is (no placeholders) ───────────────────────────
    shutil.copy(TEMPLATES_DIR / "hub.txt", output_dir / "hub.txt")
    print(f"  Wrote hub/hub.txt")

    # ── genomes.txt — one stanza per successfully built assembly ─────────
    # The template file contains one stanza; we render it once per assembly
    # and join them with a blank line separator (UCSC convention).
    raw_genome_stanza = _strip_comments(
        (TEMPLATES_DIR / "genomes.txt").read_text(encoding="utf-8")
    )
    genome_blocks = [
        raw_genome_stanza.format(assembly=asm)
        for asm in assemblies
    ]
    (output_dir / "genomes.txt").write_text(
        "\n\n".join(genome_blocks) + "\n", encoding="utf-8"
    )
    print(f"  Wrote hub/genomes.txt  ({len(assemblies)} assembly stanza(s))")

    # ── Per-assembly: trackDb.txt and dbRIP.html ──────────────────────────
    composite_block = _strip_comments(
        (TEMPLATES_DIR / "trackDb_composite.txt").read_text(encoding="utf-8")
    )
    subtrack_template = _strip_comments(
        (TEMPLATES_DIR / "trackDb_subtrack.txt").read_text(encoding="utf-8")
    )

    for assembly in assemblies:
        asm_dir = output_dir / assembly
        asm_dir.mkdir(parents=True, exist_ok=True)

        # Build one sub-track stanza per ME type, then append after the composite header.
        # Each sub-track stanza is indented with 4 spaces (already in the template).
        sub_stanzas = []
        for me_type in me_types:
            color = ME_TYPE_COLORS.get(me_type, DEFAULT_COLOR)
            rendered = subtrack_template.format(
                me_type=me_type,
                me_type_lower=me_type.lower(),
                assembly=assembly,
                hub_url=hub_url,
                color=color,
            )
            sub_stanzas.append(rendered)

        trackdb_content = composite_block + "\n\n" + "\n\n".join(sub_stanzas) + "\n"
        (asm_dir / "trackDb.txt").write_text(trackdb_content, encoding="utf-8")
        print(f"  Wrote hub/{assembly}/trackDb.txt  ({len(me_types)} sub-track(s))")

        # dbRIP.html — copy as-is (no placeholders; same for all assemblies)
        shutil.copy(TEMPLATES_DIR / "dbRIP.html", asm_dir / "dbRIP.html")
        print(f"  Wrote hub/{assembly}/dbRIP.html")


# ── Build metadata ────────────────────────────────────────────────────────

def write_build_meta(
    output_dir: Path,
    api_url: str,
    hub_url: str,
    assemblies: list[str],
    me_types: list[str],
    row_counts: dict[str, int],
):
    """Write a JSON file recording when and how the hub was last built.

    This file is read by --status to detect whether the hub is stale
    (i.e. new rows have been added to the DB since the hub was built).

    Example output:
        {
          "built_at": "2026-03-21T18:00:00Z",
          "api_url": "http://localhost:8000",
          "hub_url": "https://aryan-jhaveri.github.io/dbRIP/hub",
          "assemblies": ["hg38"],
          "me_types": ["ALU", "LINE1", "SVA"],
          "row_counts": {"ALU": 33709, "LINE1": 6958, "SVA": 4317}
        }
    """
    meta = {
        "built_at":   datetime.now(timezone.utc).isoformat(),
        "api_url":    api_url,
        "hub_url":    hub_url,
        "assemblies": assemblies,
        "me_types":   me_types,
        "row_counts": row_counts,
    }
    meta_path = output_dir / ".build_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"  Wrote hub/.build_meta.json")


def show_status(output_dir: Path, api_url: str):
    """Compare the last hub build to current API row counts.

    Reads hub/.build_meta.json and compares its stored row counts to a
    fresh call to GET /v1/stats?by=me_type. Reports stale ME types.
    """
    meta_path = output_dir / ".build_meta.json"

    if not meta_path.exists():
        print("Hub has not been built yet (hub/.build_meta.json not found).")
        print()
        print("Run a full build first:")
        print("  python scripts/build_trackhub.py \\")
        print("    --api-url http://localhost:8000 \\")
        print("    --hub-url https://aryan-jhaveri.github.io/dbRIP/hub")
        return

    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    print(f"Last built:  {meta.get('built_at', '?')}")
    print(f"Hub URL:     {meta.get('hub_url', '?')}")
    print(f"Assemblies:  {', '.join(meta.get('assemblies', []))}")
    print(f"ME types:    {', '.join(meta.get('me_types', []))}")
    print()

    stored: dict[str, int] = meta.get("row_counts", {})
    current = get_row_counts_from_api(api_url)

    if not current:
        print(f"Could not reach API at {api_url} — cannot check currency.")
        print("Start the API with:  uvicorn app.main:app --host 127.0.0.1 --port 8000")
        return

    all_keys = sorted(set(list(stored.keys()) + list(current.keys())))
    all_match = True

    print(f"  {'ME Type':<12} {'Hub count':>10}  {'API count':>10}  Status")
    print(f"  {'-'*12}  {'-'*10}  {'-'*10}  ------")
    for me_type in all_keys:
        hub_n   = stored.get(me_type, 0)
        api_n   = current.get(me_type, 0)
        status  = "OK" if hub_n == api_n else "STALE"
        if status != "OK":
            all_match = False
        print(f"  {me_type:<12} {hub_n:>10,}  {api_n:>10,}  {status}")

    print()
    if all_match:
        print("Hub is UP TO DATE.")
    else:
        print("Hub is STALE — rebuild with:")
        print(f"  python scripts/build_trackhub.py \\")
        print(f"    --api-url {api_url} \\")
        print(f"    --hub-url {meta.get('hub_url', 'YOUR_HUB_URL')}")


# ── Per-assembly build functions ──────────────────────────────────────────

def build_hg38(
    api_url: str,
    output_dir: Path,
    me_types: list[str],
    dry_run: bool,
) -> dict[str, int]:
    """Build bigBed files for hg38 by exporting BED data from the API.

    Pipeline per ME type:
        1. GET /v1/export?format=bed&me_type={TYPE}  → raw BED file (temp)
        2. sort -k1,1 -k2,2n                         → sorted BED file (temp)
        3. fetchChromSizes hg38                       → hg38.chrom.sizes (cached)
        4. bedToBigBed -type=bed6 ...                 → dbrip_{type}_hg38.bb

    In dry-run mode, steps 1-4 are skipped (no API call, no UCSC tools).

    Returns a dict of {me_type: row_count} for writing to .build_meta.json.
    """
    assembly = "hg38"
    asm_dir  = output_dir / assembly

    if dry_run:
        # Template rendering (which happens after this function) still needs
        # the assembly directory to exist.
        asm_dir.mkdir(parents=True, exist_ok=True)
        print(f"  [DRY RUN] Skipping BED download and bigBed conversion for {assembly}.")
        return {}

    asm_dir.mkdir(parents=True, exist_ok=True)

    # Fetch chromosome sizes once; reuse for all ME types in this assembly.
    # fetchChromSizes contacts UCSC's servers, so we cache the result.
    chrom_sizes = asm_dir / f"{assembly}.chrom.sizes"
    if not chrom_sizes.exists():
        fetch_chrom_sizes(assembly, chrom_sizes)
    else:
        print(f"  Using cached {chrom_sizes.name}")

    row_counts: dict[str, int] = {}

    # Use a temporary directory for intermediate BED files.
    # These can be large (the full ALU export is ~3 MB); they're cleaned up
    # automatically when the 'with' block exits.
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)

        for me_type in me_types:
            print(f"\n  [{assembly}] Processing {me_type} ...")

            # Step 1 — download BED
            raw_bed = tmp / f"{me_type}_raw.bed"
            fetch_bed_to_file(api_url, me_type, raw_bed)

            # Count insertions (each non-empty line = one insertion)
            n_rows = sum(1 for ln in raw_bed.read_text().splitlines() if ln.strip())
            row_counts[me_type] = n_rows
            print(f"    {n_rows:,} insertions")

            if n_rows == 0:
                # bedToBigBed cannot handle an empty input file; skip.
                print(f"    WARNING: no rows returned for {me_type} — skipping bigBed")
                continue

            # Step 1.5 — filter out invalid rows (end <= start)
            # Some insertions in the source CSV have swapped start/end.
            # The DB preserves them (no data cleaning rule), but bedToBigBed rejects them.
            filtered_bed = tmp / f"{me_type}_filtered.bed"
            n_invalid = filter_invalid_bed_rows(raw_bed, filtered_bed)
            if n_invalid > 0:
                print(f"    WARNING: {n_invalid} rows with end <= start (dropped for bigBed)")

            # Step 2 — sort
            sorted_bed = tmp / f"{me_type}_sorted.bed"
            sort_bed(filtered_bed, sorted_bed)

            # Steps 3+4 — convert to bigBed
            bb_path = asm_dir / f"dbrip_{me_type.lower()}_{assembly}.bb"
            convert_to_bigbed(sorted_bed, chrom_sizes, bb_path)
            print(f"    Written: hub/{assembly}/{bb_path.name}")

    return row_counts


def build_hg19(
    fasta_path: Path,
    output_dir: Path,
    me_types: list[str],
    dry_run: bool,
):
    """Build bigBed files for hg19 using native coordinates from a FASTA file.

    The lab's supplementary FASTA (HS-ME.hg19.fa) encodes hg19 coordinates
    in each header line. We parse those directly — no liftOver required.

    Why not use liftOver?
        - liftOver needs a chain file binary and produces unmapped entries
        - The FASTA contains the lab's own authoritative hg19 positions
        - Native coordinates are exact; liftOver introduces rounding error

    Pipeline per ME type:
        1. Parse FASTA headers → (chrom, start, end, id, strand) tuples
        2. Write raw BED6 file (temp)
        3. sort -k1,1 -k2,2n             → sorted BED (temp)
        4. fetchChromSizes hg19          → hg19.chrom.sizes (cached)
        5. bedToBigBed -type=bed6 ...    → dbrip_{type}_hg19.bb
    """
    assembly = "hg19"
    asm_dir  = output_dir / assembly
    asm_dir.mkdir(parents=True, exist_ok=True)

    if dry_run:
        print(f"  [DRY RUN] Skipping FASTA parse and bigBed conversion for {assembly}.")
        return

    # Parse all records from the FASTA (groups by ME type from field [2])
    all_records = parse_hg19_fasta(fasta_path)

    # Only build tracks for ME types in our list (the same set as hg38).
    # Types in the FASTA but not in me_types are silently ignored.
    types_to_build = [t for t in me_types if t in all_records]
    missing = [t for t in me_types if t not in all_records]
    if missing:
        print(f"  NOTE: these ME types are not in the hg19 FASTA: {missing}")

    # Fetch chromosome sizes (once; cached)
    chrom_sizes = asm_dir / f"{assembly}.chrom.sizes"
    if not chrom_sizes.exists():
        fetch_chrom_sizes(assembly, chrom_sizes)
    else:
        print(f"  Using cached {chrom_sizes.name}")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)

        for me_type in types_to_build:
            records = all_records[me_type]
            print(f"\n  [{assembly}] {me_type}: {len(records):,} entries from FASTA")

            if len(records) == 0:
                print(f"    WARNING: no records for {me_type} — skipping bigBed")
                continue

            # Write raw BED from FASTA-parsed tuples
            raw_bed = tmp / f"hg19_{me_type}_raw.bed"
            write_bed_from_records(records, raw_bed)

            # Filter out invalid rows (end <= start)
            filtered_bed = tmp / f"hg19_{me_type}_filtered.bed"
            n_invalid = filter_invalid_bed_rows(raw_bed, filtered_bed)
            if n_invalid > 0:
                print(f"    WARNING: {n_invalid} rows with end <= start (dropped for bigBed)")

            # Sort and convert
            sorted_bed = tmp / f"hg19_{me_type}_sorted.bed"
            sort_bed(filtered_bed, sorted_bed)

            bb_path = asm_dir / f"dbrip_{me_type.lower()}_{assembly}.bb"
            convert_to_bigbed(sorted_bed, chrom_sizes, bb_path)
            print(f"    Written: hub/{assembly}/{bb_path.name}")


# ── Entry point ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Build the dbRIP UCSC Track Hub (bigBed files + hub config).",
        epilog=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--api-url",
        default="http://localhost:8000",
        help="Base URL of the running FastAPI instance  (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--hub-url",
        metavar="URL",
        help="Public HTTPS base URL where hub/ will be served — used to construct "
             "bigDataUrl values in trackDb.txt  (required unless --status)",
    )
    parser.add_argument(
        "--output-dir",
        default=str(PROJECT_ROOT / "hub"),
        metavar="PATH",
        help="Local directory to write all output  (default: hub/)",
    )
    parser.add_argument(
        "--assemblies",
        nargs="+",
        default=["hg38"],
        metavar="ASSEMBLY",
        help="Assemblies to build  (default: hg38).  "
             "hg19 requires --hg19-fasta.",
    )
    parser.add_argument(
        "--me-types",
        nargs="+",
        default=["all"],
        metavar="TYPE",
        help="ME families to build tracks for  (default: all = auto-detect from API).  "
             "Example: --me-types ALU LINE1 SVA",
    )
    parser.add_argument(
        "--hg19-fasta",
        metavar="PATH",
        help="Path to HS-ME.hg19.fa for native hg19 coordinates  "
             "(required when hg19 is in --assemblies)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Render hub config templates only; skip BED download, sort, and bedToBigBed.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Compare the last hub build to the current API row counts, then exit.",
    )

    args = parser.parse_args()
    output_dir = Path(args.output_dir)

    # ── --status mode: compare hub build to current API ───────────────────
    if args.status:
        show_status(output_dir, args.api_url)
        return

    # ── Validate required flags ───────────────────────────────────────────
    if not args.hub_url:
        parser.error(
            "--hub-url is required.\n"
            "Example: --hub-url https://aryan-jhaveri.github.io/dbRIP/hub\n"
            "(Update the URL when the lab forks this repo to a permanent host.)"
        )

    if "hg19" in args.assemblies and not args.hg19_fasta:
        parser.error(
            "--hg19-fasta is required when hg19 is in --assemblies.\n"
            "Download HS-ME.hg19.fa from dbrip.brocku.ca/dbRIPdownload/ "
            "into data/raw/ and pass --hg19-fasta data/raw/HS-ME.hg19.fa"
        )

    if args.hg19_fasta and not Path(args.hg19_fasta).exists():
        parser.error(f"hg19 FASTA file not found: {args.hg19_fasta}")

    # ── Check that UCSC tools are installed ───────────────────────────────
    if not check_tools(args.dry_run):
        sys.exit(1)

    # ── Resolve ME types ──────────────────────────────────────────────────
    # "all" means auto-detect from the API; otherwise use the list as given.
    if args.me_types == ["all"]:
        me_types = get_me_types_from_api(args.api_url)
    else:
        me_types = [t.upper() for t in args.me_types]
        print(f"Using specified ME types: {me_types}")

    print()
    print(f"Output dir:  {output_dir}")
    print(f"Hub URL:     {args.hub_url}")
    print(f"Assemblies:  {args.assemblies}")
    print(f"ME types:    {me_types}")
    print(f"Dry run:     {args.dry_run}")
    print()

    # ── Build tracks per assembly ─────────────────────────────────────────
    built_assemblies: list[str] = []
    all_row_counts:   dict[str, int] = {}

    for assembly in args.assemblies:
        print(f"=== Assembly: {assembly} ===")

        if assembly == "hg38":
            row_counts = build_hg38(
                api_url    = args.api_url,
                output_dir = output_dir,
                me_types   = me_types,
                dry_run    = args.dry_run,
            )
            all_row_counts.update(row_counts)
            built_assemblies.append(assembly)

        elif assembly == "hg19":
            build_hg19(
                fasta_path = Path(args.hg19_fasta),
                output_dir = output_dir,
                me_types   = me_types,
                dry_run    = args.dry_run,
            )
            built_assemblies.append(assembly)

        else:
            print(f"  WARNING: Assembly '{assembly}' is not supported. Skipping.")

        print()

    # ── Render hub config templates ───────────────────────────────────────
    print(f"=== Rendering hub config templates ===")
    render_templates(
        output_dir = output_dir,
        assemblies = built_assemblies,
        me_types   = me_types,
        hub_url    = args.hub_url,
    )
    print()

    # ── Write build metadata (skipped for dry run) ────────────────────────
    if not args.dry_run:
        print("=== Writing build metadata ===")
        write_build_meta(
            output_dir = output_dir,
            api_url    = args.api_url,
            hub_url    = args.hub_url,
            assemblies = built_assemblies,
            me_types   = me_types,
            row_counts = all_row_counts,
        )
        print()

    # ── Summary ───────────────────────────────────────────────────────────
    print("Done.")

    if args.dry_run:
        print()
        print("Dry run complete — hub config templates written, no bigBed files produced.")
        print("Run without --dry-run for a full build (requires bedToBigBed + fetchChromSizes).")
    else:
        hub_txt_url = f"{args.hub_url.rstrip('/')}/hub.txt"
        print()
        print("To load this hub in the UCSC Genome Browser:")
        print("  My Data → Track Hubs → My Hubs → paste:")
        print(f"  {hub_txt_url}")
        print()
        print("Or use this direct link (bookmark it):")
        print(f"  https://genome.ucsc.edu/cgi-bin/hgTracks?hubUrl={hub_txt_url}")


if __name__ == "__main__":
    main()
