# Frontend

## Overview

A React SPA (single-page application) that calls the FastAPI backend. Built with Vite, styled with Tailwind + shadcn/ui. No Node server needed in production; the build outputs static files that can be served by FastAPI, GitHub Pages, or any file host.

## Why this stack

| Decision | Reasoning |
|----------|-----------|
| Vite + React over Next.js | FastAPI is already the backend. No SSR needed (research tool, no SEO). Vite gives fast dev builds and outputs static files. |
| React over Vue/Angular | gnomAD uses React. IGV.js integrates well with React. Largest ecosystem for genomics UI. |
| TanStack Table over AG Grid | Free, headless (full UI control), server-side pagination built in. |
| TanStack Query | Handles caching, loading states, background refetching for API calls. Pairs with TanStack Table. |
| Tailwind + shadcn/ui | Accessible component library. Checkboxes, dropdowns, data tables, file inputs out of the box. |
| IGV.js | Simplest way to embed a genome browser. Can render custom BED tracks. |

## Six tabs

| Tab | Page component | Purpose |
|-----|---------------|---------|
| Interactive Search | `InteractiveSearch.tsx` | Main UI: table + global search + column filters + population frequency expansion |
| File Search | `FileSearch.tsx` | Upload BED/CSV/TSV, find overlapping insertions within a configurable window |
| Batch Search | `BatchSearch.tsx` | Checkbox filters for ME type, category, annotation, strand, chromosome |
| IGV Viewer | `IgvViewer.tsx` | Embedded genome browser with file upload and locus navigation |
| API Reference | `ApiRef.tsx` | Static endpoint documentation |
| CLI Reference | `CliRef.tsx` | Static CLI command reference |

---

## DataTable: two independent interaction systems

`DataTable.tsx` is a generic table component with two completely separate click systems:

| System | Trigger | Visual effect | What it does |
|--------|---------|--------------|-------------|
| Row click | Click anywhere except the checkbox cell. Shift+click for range. | Blue `bg-blue-100` highlight | Populates `onSelectionChange` for Copy/View buttons |
| Checkbox | Click the checkbox. Shift+click for range. Header checkbox for page. | Shows/hides a nested `<tr>` below that row | Expands `renderExpandedRow` content |

The `renderExpandedRow` prop enables checkboxes. In InteractiveSearch, expanding a row renders a `PopFreqTable` component that calls `useInsertion(id)` to fetch and display all 33 population frequencies.

The separation lets a user select rows for bulk export AND expand rows for population details without confusion.

---

## Action bar (when rows are selected)

| Button | What it does |
|--------|-------------|
| Copy N rows | Fetches full detail (13 fields + 33 pop freqs) for each selected row. Copies as TSV to clipboard. |
| View in IGV | Merges selected rows into one bounding region per chromosome. Navigates IGV to the chromosome with the most selected rows. IGV only accepts one locus at a time. |
| View in UCSC | Opens the UCSC Genome Browser in new tabs. One tab per chromosome with merged region. Max 5 tabs (popup blocker limit). |

### Multi-chromosome warnings

When selected rows span multiple chromosomes, amber warning text appears below the buttons:

- **IGV**: "Selected rows span N chromosomes. IGV will show only chrX (M rows, merged region start-end)."
- **UCSC (>5 chroms)**: "UCSC will open 5 of N chromosomes. K chromosomes omitted: chrA, chrB, ..."
- **UCSC (<=5 chroms)**: "UCSC will open N tabs (one per chromosome)."

### Select All / Deselect All

Button in the DataTable pagination bar. Selects all rows on the current page. Selections clear on page change.

---

## Key files

### `frontend/src/api/client.ts`

Typed fetch wrappers for all FastAPI endpoints. The API base URL reads from the `VITE_API_URL` environment variable at build time, falling back to `/v1` for local development (where Vite's proxy handles routing).

```ts
const BASE = import.meta.env.VITE_API_URL ?? "/v1";
```

### `frontend/src/hooks/useInsertions.ts`

TanStack Query hooks:

- `useInsertions(params)` - paginated list query, keyed by all filter params
- `useInsertion(id)` - single insertion detail, cached by ID

### `frontend/src/types/insertion.ts`

TypeScript interfaces matching the Pydantic schemas in `app/schemas.py`:

- `InsertionSummary` - lightweight (no population frequencies)
- `InsertionDetail` - full detail with `populations` array

### `frontend/src/constants/filters.ts`

Single source of truth for all dropdown options used across pages:

- `POPULATIONS` - flat list for the Population filter dropdown
- `POP_GROUPS` - grouped structure for PopFreqTable headers and toggle buttons
- `ME_TYPE_OPTIONS`, `CATEGORY_OPTIONS`, `ANNOTATION_OPTIONS`, `STRAND_OPTIONS`

Add or rename options here so both InteractiveSearch and BatchSearch stay in sync.

### `frontend/src/utils/genomeBrowserHelpers.ts`

Pure utility functions (no React) for genome browser integration:

- `groupAndMergeByChrom(rows)` - groups rows by chromosome, computes bounding region per chromosome
- `buildUcscUrl(chrom, start, end, db?)` - UCSC Genome Browser URL
- `buildIgvLocus(chrom, start, end)` - IGV locus string (`chr1:100-200`)

---

## Development

```bash
cd frontend
npm install        # first time
npm run dev        # dev server at http://localhost:5173
npx tsc --noEmit   # type-check without building
npm run build      # production build to frontend/dist/
```

The Vite dev server proxies `/v1/*` requests to `localhost:8000`, so the API must be running.

## Deployment

| Environment | How the frontend is served |
|-------------|---------------------------|
| Local dev | `npm run dev` starts Vite dev server (port 5173) with proxy to `/v1` |
| GitHub Pages | `npm run build` outputs `frontend/dist/`, deployed by CI to `gh-pages /` |
| Same server as API | `frontend/dist/` served by FastAPI's `StaticFiles` mount |

For GitHub Pages, `VITE_API_URL` is set at build time in the CI workflow:

```yaml
env:
  VITE_API_URL: https://dbrip-api.onrender.com/v1
```
