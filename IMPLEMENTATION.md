# Track Hub Implementation — Progress Log

Tracks progress on the 11-step UCSC Track Hub integration plan from
`NOTEBOOK/TRACK_HUB.md`. Each step is one file → one commit.

---

## Status

| Step | File | Status | Notes |
|------|------|--------|-------|
| 1    | `data/hub/templates/hub.txt`                 | ✅ Done | Static hub entry point |
| 2    | `data/hub/templates/genomes.txt`              | ✅ Done | Assembly stanza template |
| 3a   | `data/hub/templates/trackDb_composite.txt`    | ✅ Done | Composite parent header |
| 3b   | `data/hub/templates/trackDb_subtrack.txt`     | ✅ Done | Per-ME-type sub-track template |
| 4    | `data/hub/templates/dbRIP.html`               | ✅ Done | Track description popup HTML |
| 5    | `scripts/build_trackhub.py`                   | ✅ Done | Full build pipeline (+ 31 tests) |
| 6    | `pyproject.toml`                              | ⬜ Next | Add `trackhub` dep group (httpx) |
| 7    | `frontend/src/api/client.ts`                  | ⬜ Todo | Switch BASE to `VITE_API_URL` env var |
| 8    | `app/main.py`                                 | ⬜ Todo | Add GitHub Pages to CORS origins |
| 9    | `.github/workflows/build-trackhub.yml`        | ⬜ Todo | CI: ingest → API → build hub → deploy |
| 9b   | `.gitignore`                                  | ⬜ Todo | Add `hub/` |
| 10   | `GUIDE.md`                                    | ⬜ Todo | Track Hub + GitHub Pages sections |
| 11   | `README.md`                                   | ⬜ Todo | Track Hub section + frontend URL |

---

## Step 5 — `scripts/build_trackhub.py`

### What it does
Full pipeline: BED export from API → sort → bedToBigBed → hub config templates.

### Key design decisions

**httpx for streaming BED export**
The full ALU dataset is ~18,000 rows. `httpx.stream()` downloads it in chunks
without loading it all into memory, matching the `StreamingResponse` the API uses.

**Dry-run mode skips BED download entirely**
`--dry-run` renders templates only — no API call, no sort, no UCSC tools.
Useful for testing template changes without the full UCSC toolchain.

**ME types are auto-detected from the API**
`GET /v1/stats?by=me_type` returns whatever ME types are in the current DB.
New types added to future CSVs automatically get their own sub-track.
Override with `--me-types ALU LINE1 SVA` when you want specific types.

**hg19 uses native FASTA coordinates (no liftOver)**
The lab's `HS-ME.hg19.fa` encodes hg19 coordinates in each FASTA header.
Parsing these directly avoids liftOver's unmapped entries and chain file dependency.

**sort before bedToBigBed is mandatory**
The API returns `chr1, chr10, chr11, chr2` order (lexicographic).
`bedToBigBed` requires records within each chromosome to be contiguous and
position-sorted. `sort -k1,1 -k2,2n` fixes this.

**`.build_meta.json` enables stale detection**
After a full build, row counts are stored. `--status` compares these to the
current API to tell you whether a rebuild is needed.

### Test coverage (31 tests in `tests/test_build_trackhub.py`)

| Class | Tests | What is verified |
|-------|-------|-----------------|
| `TestStripComments` | 5 | Comment/blank line removal from templates |
| `TestParseHg19Fasta` | 7 | Header parsing, coordinate conversion, error handling |
| `TestWriteBedFromRecords` | 4 | BED6 format and column values |
| `TestRenderTemplates` | 9 | All template outputs, color palette, URL construction |
| `TestWriteBuildMeta` | 3 | JSON file format and field values |
| `TestCheckTools` | 3 | Tool detection, dry-run bypass, missing tool message |

---

## Next — Step 6: `pyproject.toml`

Add a `trackhub` optional-dependency group with `httpx`:

```toml
trackhub = [
    "httpx>=0.27",
]
```

Update `all` to include it:
```toml
all = [
    "dbrip-api[cli,api,ingest,trackhub]",
]
```

`httpx` is already in the `dev` group so tests already have it. The new group
lets production installs pull it without the full dev toolchain:
```bash
pip install -e ".[trackhub]"    # just httpx + the API deps
pip install -e ".[all]"         # everything
```
