---
name: Track Hub Implementation Status
description: 11-step UCSC Track Hub plan — current progress and remaining steps
type: project
---

Steps 1–5 complete (templates + build script). Steps 6–11 pending.

| Step | File | Status |
|------|------|--------|
| 1–4  | `data/hub/templates/*`              | ✅ Done |
| 5    | `scripts/build_trackhub.py`         | ✅ Done (+ 31 tests) |
| 6    | `pyproject.toml` (trackhub group)   | ⬜ Next |
| 7    | `frontend/src/api/client.ts`        | ⬜ Todo |
| 8    | `app/main.py` (CORS origins)        | ⬜ Todo |
| 9    | `.github/workflows/build-trackhub.yml` | ⬜ Todo |
| 9b   | `.gitignore` (add hub/)             | ⬜ Todo |
| 10   | `GUIDE.md`                          | ⬜ Todo |
| 11   | `README.md`                         | ⬜ Todo |

**Why:** UCSC Track Hub lets the browser load dbRIP insertions as colored bigBed tracks, visible directly in the genome view. bigBed requires sorted + indexed binary — plain BED can't be remote-hosted. GitHub Pages hosts the static hub files; Render hosts the API.

**How to apply:** The remaining steps are mostly small (pyproject, CORS, gitignore, docs). The complex one is step 9 (CI workflow) which wires up: ingest → uvicorn → health check → build script → deploy to gh-pages. The `--hub-url` will need updating when the lab forks the repo.
