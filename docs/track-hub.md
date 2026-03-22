# Track Hub

## What it is

The UCSC Genome Browser (genome.ucsc.edu) can load custom datasets via a Track Hub. A hub is a small set of config files you host on any public HTTPS server. When a researcher loads the hub, UCSC shows dbRIP insertions as colored horizontal bars on the genome, one sub-track per ME family (ALU red, LINE1 blue, SVA green).

The data lives in **bigBed** files. bigBed is a sorted, indexed binary format that supports byte-range fetches, so UCSC only downloads the visible region. No full file download, no upload to UCSC.

### Load the hub

My Data > Track Hubs > My Hubs > paste:
```
https://aryan-jhaveri.github.io/dbRIP/hub/hub.txt
```

---

## Why bigBed

UCSC cannot read plain text BED files from a hub. It would have to download the entire file to show any region. bigBed solves this:

```
API export (plain BED6, 0-based coords)
    | sort -k1,1 -k2,2n          (chromosome-numeric order)
    | bedToBigBed -type=bed6     (no AutoSQL needed for standard BED6)
    | .bb file (binary, indexed)
    | hosted at a public HTTPS URL
    | trackDb.txt bigDataUrl points there
    | UCSC loads via hub.txt
```

The UCSC tools (`bedToBigBed`, `fetchChromSizes`) are available as pre-built static binaries or via conda.

---

## Hub file structure

Source templates (version-controlled):
```
data/hub/templates/
  hub.txt                    <- entry point (UCSC fetches this first)
  genomes.txt                <- one stanza per assembly
  trackDb_composite.txt      <- composite parent track header
  trackDb_subtrack.txt       <- per-ME-type sub-track template
  dbRIP.html                 <- track description popup
```

Build output (gitignored, deployed to gh-pages):
```
hub/
  hub.txt
  genomes.txt
  hg38/
    trackDb.txt              <- composite + all sub-tracks rendered together
    dbRIP.html               <- description popup
    hg38.chrom.sizes
    dbrip_alu_hg38.bb        <- bigBed per ME type
    dbrip_line1_hg38.bb
    dbrip_sva_hg38.bb
  .build_meta.json           <- records when/how the hub was built
```

### Template variables

The sub-track template uses placeholders that the build script fills in:

- `{me_type}`, `{me_type_lower}` - ME family name
- `{hub_url}` - public base URL of the hub
- `{assembly}` - genome assembly (e.g. `hg38`)
- `{color}` - RGB color for the track

### Color mapping

```python
ME_TYPE_COLORS = {
    "ALU":   "200,0,0",      # red
    "LINE1": "0,0,180",      # navy blue
    "SVA":   "0,150,0",      # forest green
    "HERVK": "150,0,150",    # purple
}
DEFAULT_COLOR = "100,100,100"  # gray fallback for any future ME type
```

### searchIndex

`searchIndex name` in the trackDb template lets researchers type a dbRIP ID (e.g. `A0000001`) into the UCSC search box and jump directly to that insertion.

---

## Build script

File: `scripts/build_trackhub.py`

Standalone CLI. Never imported by the API (same rule as `scripts/ingest.py`).

### Commands

```bash
# Dry run (renders templates only, skip bedToBigBed, no UCSC tools needed)
python scripts/build_trackhub.py \
  --api-url http://localhost:8000 \
  --hub-url https://aryan-jhaveri.github.io/dbRIP/hub \
  --dry-run

# Full build (requires bedToBigBed + fetchChromSizes on PATH)
python scripts/build_trackhub.py \
  --api-url http://localhost:8000 \
  --hub-url https://aryan-jhaveri.github.io/dbRIP/hub

# Check if the hub is stale vs. current API row count
python scripts/build_trackhub.py --status
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--api-url` | `http://localhost:8000` | Base URL of the running FastAPI instance |
| `--hub-url` | (required) | Public base URL where hub/ will be served |
| `--output-dir` | `hub/` | Local directory to write all output |
| `--assemblies` | `hg38` | Space-separated list |
| `--me-types` | `all` | ME families to build tracks for. `all` auto-detects from `GET /v1/stats?by=me_type` |
| `--dry-run` | False | Skip bedToBigBed; only write config files |
| `--status` | False | Compare `.build_meta.json` to current API row count |
| `--cleanup` | False | Delete `hub/archive/` (old .bb files from previous builds) |
| `--hg19-fasta` | not set | Path to `HS-ME.hg19.fa` for native hg19 track |

### Build pipeline (per ME type)

1. `GET /v1/export?format=bed&me_type={TYPE}` - stream BED6 response
2. `sort -k1,1 -k2,2n` - fix chromosome order (API sorts lexicographically: chr1, chr10, chr11, chr2...; bedToBigBed requires numeric: chr1, chr2, chr3...)
3. `fetchChromSizes hg38` - get chromosome sizes (cached per build)
4. `bedToBigBed -type=bed6` - convert sorted BED to indexed binary
5. Render templates to output directory
6. Write `.build_meta.json` for stale detection

### Installing UCSC tools

```bash
# Via conda
conda install -c bioconda ucsc-bedtobigbed ucsc-fetchchromsizes

# Or download static binaries (Linux x86_64)
wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/bedToBigBed
wget https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/fetchChromSizes
chmod +x bedToBigBed fetchChromSizes

# macOS
wget https://hgdownload.soe.ucsc.edu/admin/exe/macOSX.x86_64/bedToBigBed
wget https://hgdownload.soe.ucsc.edu/admin/exe/macOSX.x86_64/fetchChromSizes
chmod +x bedToBigBed fetchChromSizes
```

---

## CI/CD

GitHub Actions workflow: `.github/workflows/build-trackhub.yml`

Triggers on:
- Push to `main` with changes to `data/raw/dbRIP_all.csv`, `frontend/src/**`, or `data/hub/templates/`
- Manual trigger from GitHub UI

### Pipeline steps

```
push to main (data/raw/*.csv or frontend/src/**)
  |
  |-- checkout + setup Python 3.13
  |-- pip install -e ".[all]"
  |-- wget bedToBigBed + fetchChromSizes (static binaries, ~5s)
  |-- python scripts/ingest.py (build SQLite from CSV)
  |-- uvicorn app.main:app & (background)
  |-- health-check loop (curl /v1/health, up to 30 attempts)
  |
  |-- python scripts/build_trackhub.py
  |     -> auto-detect ME types from API
  |     -> for each ME type:
  |         GET /v1/export?format=bed&me_type=TYPE
  |         sort -k1,1 -k2,2n
  |         bedToBigBed -> hub/hg38/dbrip_{type}_hg38.bb
  |     -> render templates
  |     -> write hub/.build_meta.json
  |
  |-- setup Node 20 + npm ci
  |-- VITE_API_URL=... npm run build
  |
  |-- deploy frontend/dist -> gh-pages / (keep_files: true)
  +-- deploy hub/ -> gh-pages /hub/ (keep_files: true)
```

### Why this order matters

- Ingest must finish before uvicorn starts. Otherwise the DB is empty, exports return 0 rows, and bedToBigBed fails on empty input.
- Both deploy steps use `keep_files: true` to prevent each from deleting the other. Frontend and hub live in the same `gh-pages` branch.

### Hub URL is dynamic

The workflow constructs the hub URL from `github.repository_owner` and `github.event.repository.name`:
```
https://<owner>.github.io/<repo>/hub
```
When the lab forks the repo, the URL updates automatically.

---

## Testing in UCSC locally

After a full build:

```bash
# Serve on your local machine
python -m http.server 8080 --directory .

# In UCSC: My Data -> Track Hubs -> My Hubs -> paste:
#   http://YOUR_LOCAL_IP:8080/hub/hub.txt
# (UCSC must be able to reach your machine. Use ngrok for a public tunnel.)
```

---

## Stale detection

After updating the CSV and re-ingesting:

```bash
python scripts/build_trackhub.py --status

# Output:
#   ME Type      Hub count   API count   Status
#   ALU            33709       33709     OK
#   LINE1           6958        7100     STALE
```

If any type shows STALE, push the new CSV to `main` and CI rebuilds automatically.

---

## Archive and cleanup

### The problem

Both deploy steps in CI use `keep_files: true` so the frontend and hub don't delete each other on gh-pages. The downside: if a rebuild drops an ME type (say the CSV no longer has PP entries), the old `dbrip_pp_hg38.bb` stays on gh-pages forever. Over time, orphan files accumulate.

### How the archive works

Before each full build (non-dry-run), the script moves all existing `.bb` files into `hub/archive/{timestamp}/`:

```
hub/archive/20260322T120000Z/
  hg38/
    dbrip_alu_hg38.bb
    dbrip_line1_hg38.bb
    dbrip_sva_hg38.bb
```

Then the build writes fresh `.bb` files. Only the new files get deployed to gh-pages. The archive stays local (it is inside `hub/` which is gitignored on `main`).

If the new build turns out bad, recover the previous `.bb` files from the archive manually.

### Cleaning up

The archive accumulates old builds. Once you're satisfied the current build is correct:

```bash
python scripts/build_trackhub.py --cleanup
```

This deletes the entire `hub/archive/` directory. The `--status` command also reports archive size so you know when cleanup is needed.

### What the archive does NOT do

The archive is a local safety net. It does not clean orphan files on gh-pages itself. To remove orphan files from gh-pages, you'd need to do a clean deploy (remove `keep_files: true` from one of the deploy steps for a single run, then re-add it). The archive prevents the problem from growing by ensuring only current `.bb` files are in `hub/` at deploy time.

---

## Known data issue: swapped coordinates

Some rows in the source CSV have `End < Start`. These rows are preserved in the API and frontend (per the "no data cleaning" rule) but are silently excluded from the track hub because bigBed requires `end > start`.

To identify them:

```bash
sqlite3 dbrip.sqlite \
  "SELECT id, chrom, start, \"end\", me_type FROM insertions WHERE \"end\" < start ORDER BY me_type;"
```

To fix: correct `Start` and `End` in `data/raw/dbRIP_all.csv`, re-ingest, and push to `main`.

---

## Future enhancements

### AutoSQL (BED6+N)

Richer UCSC click popups showing me_type, annotation, TSD, variant_class. Requires coordinating changes across 5 files. Deferred because the core visualization (positions, colors, search by ID) is identical with plain BED6.

### hg19 track

The lab's `HS-ME.hg19.fa` contains native hg19 coordinates in FASTA headers. Parsing these directly avoids liftOver (which produces unmapped entries and requires a chain file). Pass `--hg19-fasta data/raw/HS-ME.hg19.fa` to enable.

### T2T-CHM13 (hs1) assembly

There are two ways to add T2T support, depending on whether the lab wants to switch the DB to hs1 or keep hg38 as the primary assembly and build hs1 tracks from a coordinate mapping.

**Option A: Switch the DB to hs1 (recommended if T2T becomes the lab's primary reference)**

The assembly is set by the manifest, not hardcoded in the schema. Produce an hs1-coordinate CSV, update the manifest to `assembly: hs1`, and re-ingest. The DB now holds hs1 data. The track hub builds hs1 bigBed files directly from the API (same pipeline as hg38 today). See [Switching assemblies](maintenance.md#switching-assemblies-eg-hg38-to-t2t-chm13) in the maintenance docs for the step-by-step and the list of hardcoded hg38 defaults that need updating.

`build_hg38()` in the build script is actually assembly-agnostic: it exports BED from the API, sorts, fetches chrom sizes, and converts to bigBed. It would work for hs1 without changes (just pass `--assemblies hs1`). The function name is misleading but the logic is generic.

hg38 tracks could still be served alongside hs1 by keeping a supplementary hg38 coordinate file (same pattern as hg19/FASTA).

**Option B: Keep hg38 in the DB, build hs1 tracks from liftOver**

This keeps the DB as hg38 and adds hs1 as a build-time conversion, the same way hg19 uses a FASTA file.

What would need to change:

1. **Chain file**: Download the hg38-to-hs1 liftOver chain from UCSC (`hg38ToHs1.over.chain.gz`).
2. **Build function**: Add a `build_hs1()` function in `build_trackhub.py`. This function would export BED from the API (hg38 coordinates), run `liftOver` to map to hs1, then feed the lifted BED through `sort` and `bedToBigBed`.
3. **Assembly branch in main()**: Add `elif assembly == "hs1"` in the assembly dispatch block.
4. **Chrom sizes**: `fetchChromSizes hs1` to get T2T chromosome sizes.
5. **CLI flag**: A `--hs1-chain` flag to pass the chain file path (same pattern as `--hg19-fasta`).

Unlike hg19 (where the lab has native coordinates in a FASTA file), T2T coordinates would come from liftOver, which means some insertions may not map. liftOver drops entries in regions that don't have a clean alignment between assemblies. The build script should log how many entries were unmapped.

**What does NOT change in either option:**

- **Ingest pipeline**: The manifest, loader, and database schema are assembly-agnostic. The `assembly` field is just a string column.
- **Templates**: The existing genomes.txt and trackDb templates already support multiple assemblies via `{assembly}` placeholders.
- **API schema**: The `assembly` field is already returned in every response.

### Population frequency tracks

Per-super-population bigBed tracks colored by allele frequency. Requires a new API export endpoint.

### UCSC public hub listing

Submit to genome-www@soe.ucsc.edu once hosted on a permanent domain.
