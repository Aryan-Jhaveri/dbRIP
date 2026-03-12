/**
 * InteractiveSearch — the main search page (Tab 1).
 *
 * WHAT THIS PAGE DOES:
 *   Replicates the Shiny app's "Interactive Search" tab:
 *     1. A global search bar (server-side LIKE across 8 columns)
 *     2. Population frequency dropdowns (population + min allele frequency)
 *     3. A data table showing insertion results with server-side pagination
 *     4. A download button for exporting filtered results as CSV
 *
 * HOW SEARCH WORKS (SERVER-SIDE):
 *   The search bar sends the typed term to the API as a "search" query param.
 *   The API applies a LIKE filter across 8 columns (id, chrom, me_type,
 *   me_category, rip_type, me_subtype, annotation, variant_class). This means:
 *     - Pagination totals are always accurate (the DB counts matching rows)
 *     - Searching "ALU" on page 3 shows exactly the ALU rows for that page
 *     - No more empty pages mid-search (the old client-side bug)
 *
 *   The debounce (300ms) prevents firing a new API request on every keystroke.
 *   We reset to page 0 whenever the search changes so we don't end up on a
 *   now-invalid page (e.g. searching narrows results to fewer pages).
 *
 * POPULATION FREQUENCY FILTERS:
 *   Two dropdowns let users narrow results by population allele frequency:
 *     - Population: one of the 33 1000 Genomes populations or 5 super-pops
 *     - Min frequency: preset thresholds (any, ≥1%, ≥5%, ≥10%, ≥50%)
 *   Both wire directly to the API's population/min_freq params. The API only
 *   applies frequency filtering when a population is selected.
 *
 * HOW IT CONNECTS TO OTHER FILES:
 *   - useInsertions (hooks/useInsertions.ts) → fetches from FastAPI
 *   - DataTable (components/DataTable.tsx) → renders the table
 *   - listInsertions (api/client.ts) → the actual fetch call
 *   - InsertionSummary (types/insertion.ts) → TypeScript type for rows
 *   - buildExportUrl (api/client.ts) → builds the CSV download link
 *
 * COLUMN DEFINITIONS:
 *   The columns array below defines every column in the table. Each column
 *   has an accessorKey (which field from the data to read) and a header
 *   (what to show in the column header). These match the fields in
 *   InsertionSummary from types/insertion.ts.
 *
 * WHY NO POPULATION FREQUENCY COLUMNS?
 *   The list endpoint (GET /v1/insertions) returns InsertionSummary, which
 *   does NOT include the 33 population frequency columns. Those are only
 *   in InsertionDetail (GET /v1/insertions/{id}). This is intentional —
 *   sending 33 extra floats per row × 50 rows = 1,650 extra values per
 *   page load. Instead, users can check a row's checkbox to expand an inline
 *   population frequency table fetched on demand.
 */

import { useState, useEffect, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import DataTable from "../components/DataTable";
import { useInsertions, useInsertion } from "../hooks/useInsertions";
import { buildExportUrl, getInsertion } from "../api/client";
import type { InsertionSummary } from "../types/insertion";

// Column header labels for the 13 summary fields.
// Used as the first part of the TSV header when copying selected rows.
const COLUMN_HEADERS = [
  "ID", "Chromosome", "Start", "End", "Category", "ME Type",
  "RIP Type", "ME Subtype", "ME Length", "Strand", "TSD",
  "Annotation", "Variant Class",
];

// Canonical population order — mirrors the manifest and export.py _POP_ORDER.
// When copying, these become the last 33 columns after the 13 summary columns.
const POP_ORDER = [
  "ACB","ASW","BEB","CDX","CEU","CHB","CHS","CLM","ESN","FIN",
  "GBR","GIH","GWD","IBS","ITU","JPT","KHV","LWK","MSL","MXL",
  "PEL","PJL","PUR","STU","TSI","YRI",
  "AFR","AMR","EAS","EUR","SAS","Non_African","All",
];

// ── Filter options ───────────────────────────────────────────────────────
// Imported from the shared constants file so InteractiveSearch and BatchSearch
// always show the same populations, ME types, annotations, etc.
import {
  POPULATIONS,
  MIN_FREQ_OPTIONS,
  ME_TYPE_OPTIONS,
  CATEGORY_OPTIONS,
  ANNOTATION_OPTIONS,
} from "../constants/filters";

// ── Column definitions ────────────────────────────────────────────────────
// Defined outside the component (static constant) because they don't depend
// on any component state. Plain accessorKey → header pairs; no custom renderers.
// Population frequencies are now shown via the checkbox expand system, not a popup.

const columns: ColumnDef<InsertionSummary, unknown>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "chrom", header: "Chromosome" },
  { accessorKey: "start", header: "Start" },
  { accessorKey: "end", header: "End" },
  { accessorKey: "me_category", header: "Category" },
  { accessorKey: "me_type", header: "ME Type" },
  { accessorKey: "rip_type", header: "RIP Type" },
  { accessorKey: "me_subtype", header: "ME Subtype" },
  { accessorKey: "me_length", header: "ME Length" },
  { accessorKey: "strand", header: "Strand" },
  { accessorKey: "tsd", header: "TSD" },
  { accessorKey: "annotation", header: "Annotation" },
  { accessorKey: "variant_class", header: "Variant Class" },
];

// ── PopFreqTable ─────────────────────────────────────────────────────────
//
// Renders a horizontal population frequency table for a single insertion.
// This is shown inline below a row when the user checks that row's checkbox.
//
// WHY A SEPARATE COMPONENT?
//   Each expanded row needs to call useInsertion(id) independently. React's
//   rules of hooks require hook calls to be at the top level of a component,
//   not inside a callback or .map(). By making PopFreqTable its own component,
//   each instance gets its own hook call and its own TanStack Query cache entry.
//
// CACHING:
//   useInsertion uses TanStack Query with the insertion ID as the cache key.
//   If the user already expanded this row on a previous visit (or the old popup
//   system loaded it), the data is already cached and renders instantly.

function PopFreqTable({ id }: { id: string }) {
  const { data, isLoading } = useInsertion(id);

  if (isLoading) return <p className="text-xs">Loading...</p>;
  if (!data) return null;

  return (
    /*
     * Horizontal layout: population codes as <th> in the header row,
     * AF values as <td> in the data row. With 33 columns this is wider
     * than the card, so overflow-x: auto lets the user scroll sideways.
     * Each cell is intentionally compact (px-2 py-0.5) to fit more columns.
     */
    <div className="overflow-x-auto">
      <table className="border-collapse border border-black dark:border-gray-500 text-xs whitespace-nowrap">
        <thead>
          <tr className="bg-white dark:bg-gray-800 border-b border-black dark:border-gray-500">
            {data.populations.map((pf) => (
              <th
                key={pf.population}
                className="border border-black dark:border-gray-500 px-2 py-0.5 font-semibold text-center"
              >
                {pf.population}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {data.populations.map((pf) => (
              <td
                key={pf.population}
                className="border border-black dark:border-gray-500 px-2 py-0.5 text-center"
              >
                {pf.af !== null ? pf.af.toFixed(4) : "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * Props for InteractiveSearch.
 *
 * onViewInIgv is optional so that existing tests that render this component
 * without any props continue to work. When present, a "View in IGV" button
 * appears in the action bar whenever exactly one row is blue-highlighted
 * (row-click selected). Clicking it switches to the IGV Viewer tab and
 * navigates to the selected insertion's genomic locus.
 */
interface InteractiveSearchProps {
  onViewInIgv?: (locus: string) => void;
}

export default function InteractiveSearch({ onViewInIgv }: InteractiveSearchProps) {
  // ── State ────────────────────────────────────────────────────────────
  // pageIndex: current page (0-based), controls which slice of data the API returns
  // pageSize: rows per page, sent as "limit" to the API
  // searchInput: what the user is typing (updates on every keystroke)
  // searchQuery: the debounced value actually sent to the API
  //   (we debounce so we're not firing a new request on every single keystroke)
  // population: selected 1000 Genomes population code (or "" for no filter)
  // minFreq: selected minimum allele frequency threshold (or "" for no filter)
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [population, setPopulation] = useState("");
  const [minFreq, setMinFreq] = useState("");

  // Fixed-value filters — each holds a comma-joined string sent to the API,
  // or "" for no filter.  Multi-select is supported via the <select multiple>
  // element; the selected options are joined with "," and the API applies an
  // IN clause when it sees multiple values.
  const [meTypes, setMeTypes] = useState<string[]>([]);
  const [meCategories, setMeCategories] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<string[]>([]);

  // Currently selected rows (row-click blue highlight), feeds the Copy button.
  // Updated by DataTable's onSelectionChange whenever the user clicks rows.
  const [selectedRows, setSelectedRows] = useState<InsertionSummary[]>([]);

  // Copy button state machine: idle → loading (fetching pop data) → done (flash "Copied!") → idle
  const [copyState, setCopyState] = useState<"idle" | "loading" | "done">("idle");

  // ── Debounce search ──────────────────────────────────────────────────
  // Wait 300ms after the user stops typing before sending the request.
  // This prevents hammering the API on every keystroke.
  // We also reset to page 0 so we don't land on a page that no longer exists
  // (e.g. if search narrows 900 rows to 12, page 5 would be empty).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Fetch data ───────────────────────────────────────────────────────
  // All filtering is server-side. The API accepts comma-separated values for
  // me_type, me_category, and annotation (IN clause) as well as free-text
  // search and population-frequency filters.
  const { data, isLoading } = useInsertions({
    limit: pageSize,
    offset: pageIndex * pageSize,
    search: searchQuery || null,
    population: population || null,
    min_freq: minFreq ? parseFloat(minFreq) : null,
    me_type: meTypes.length > 0 ? meTypes.join(",") : null,
    me_category: meCategories.length > 0 ? meCategories.join(",") : null,
    annotation: annotations.length > 0 ? annotations.join(",") : null,
  });

  // ── Pagination handler ───────────────────────────────────────────────
  // Called by DataTable when the user clicks Next/Previous or changes page size.
  const handlePaginationChange = useCallback(
    (newPageIndex: number, newPageSize: number) => {
      setPageIndex(newPageIndex);
      setPageSize(newPageSize);
    },
    []
  );

  // ── Export URL ───────────────────────────────────────────────────────
  const exportUrl = buildExportUrl("csv", {
    search: searchQuery || null,
    population: population || null,
    min_freq: minFreq ? parseFloat(minFreq) : null,
    me_type: meTypes.length > 0 ? meTypes.join(",") : null,
    me_category: meCategories.length > 0 ? meCategories.join(",") : null,
    annotation: annotations.length > 0 ? annotations.join(",") : null,
  });

  // ── Copy selected rows as TSV (with population frequencies) ──────────
  // Fetches full InsertionDetail for each selected row in parallel, then
  // writes a TSV to the clipboard with 13 summary columns + 33 pop columns.
  //
  // WHY ASYNC?
  //   The summary rows shown in the table don't include population frequencies
  //   (too expensive to load for all 50 rows per page). When copying, we fetch
  //   the detail for each selected ID in parallel. TanStack Query caches these,
  //   so if the user already expanded a row's checkbox to view its frequencies,
  //   that detail is already cached and the copy is instant for that row.
  const handleCopySelected = useCallback(async () => {
    setCopyState("loading");
    try {
      // Fetch InsertionDetail for each selected row in parallel.
      const details = await Promise.all(selectedRows.map((r) => getInsertion(r.id)));

      const summaryFields: (keyof InsertionSummary)[] = [
        "id", "chrom", "start", "end", "me_category", "me_type",
        "rip_type", "me_subtype", "me_length", "strand", "tsd",
        "annotation", "variant_class",
      ];

      const header = [...COLUMN_HEADERS, ...POP_ORDER].join("\t");
      const rows = details.map((detail) => {
        // Build a fast lookup: population code → AF value
        const popAf: Record<string, number | null> = {};
        detail.populations.forEach((pf) => { popAf[pf.population] = pf.af; });

        const summaryVals = summaryFields.map((f) => detail[f] ?? "");
        const popVals = POP_ORDER.map((pop) =>
          popAf[pop] != null ? (popAf[pop] as number).toFixed(4) : ""
        );
        return [...summaryVals, ...popVals].join("\t");
      });

      await navigator.clipboard.writeText([header, ...rows].join("\n"));
      setCopyState("done");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      // If fetch or clipboard fails, silently reset so the button is usable again.
      setCopyState("idle");
    }
  }, [selectedRows]);

  return (
    <div>
      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="text-sm font-semibold">Search:</label>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="e.g. ALU, INTRONIC, chr1 (case-insensitive)"
          className="border border-black dark:border-gray-500 px-2 py-1 text-sm flex-1 max-w-md"
        />
        {searchInput && (
          <button
            onClick={() => {
              setSearchInput("");
              setSearchQuery("");
            }}
            className="border border-black dark:border-gray-500 px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Population frequency filters ────────────────────────────────── */}
      {/* Two dropdowns: which population to filter by, and minimum frequency.
          Min freq only applies when a population is selected (API ignores it
          if population is absent). We show both dropdowns together so it's
          clear they're related. */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="text-sm font-semibold">Population:</label>
        <select
          value={population}
          onChange={(e) => {
            setPopulation(e.target.value);
            setPageIndex(0);
          }}
          className="border border-black dark:border-gray-500 px-2 py-1 text-sm"
        >
          <option value="">Any population</option>
          {POPULATIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <label className="text-sm font-semibold">Min frequency:</label>
        <select
          value={minFreq}
          onChange={(e) => {
            setMinFreq(e.target.value);
            setPageIndex(0);
          }}
          disabled={!population}
          className="border border-black dark:border-gray-500 px-2 py-1 text-sm disabled:opacity-40"
        >
          {MIN_FREQ_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Fixed-value filters ─────────────────────────────────────────── */}
      {/* Three <select multiple> dropdowns for ME Type, Category, and Annotation.
          Hold Ctrl/Cmd to pick multiple values. Each sends a comma-joined value
          to the API which applies a SQL IN clause. Changing any filter resets to
          page 0 so the user doesn't land on a now-invalid page. */}
      <div className="mb-4 flex flex-wrap items-start gap-4">
        <label className="text-sm">
          <span className="font-semibold block mb-1">ME Type:</span>
          <select
            multiple
            value={meTypes}
            onChange={(e) => {
              setMeTypes(Array.from(e.target.selectedOptions, (o) => o.value));
              setPageIndex(0);
            }}
            className="border border-black dark:border-gray-500 px-2 py-1 text-sm h-24"
          >
            {ME_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="font-semibold block mb-1">Category:</span>
          <select
            multiple
            value={meCategories}
            onChange={(e) => {
              setMeCategories(Array.from(e.target.selectedOptions, (o) => o.value));
              setPageIndex(0);
            }}
            className="border border-black dark:border-gray-500 px-2 py-1 text-sm h-24"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="font-semibold block mb-1">Annotation:</span>
          <select
            multiple
            value={annotations}
            onChange={(e) => {
              setAnnotations(Array.from(e.target.selectedOptions, (o) => o.value));
              setPageIndex(0);
            }}
            className="border border-black dark:border-gray-500 px-2 py-1 text-sm h-24"
          >
            {ANNOTATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <p className="text-xs self-end pb-1">Hold Ctrl/Cmd to select multiple</p>
      </div>

      {/* ── Error display ──────────────────────────────────────────────── */}
      {!isLoading && !data && (
        <p className="text-sm mb-4">
          Unable to load data. Make sure the API is running (uvicorn app.main:app --reload).
        </p>
      )}

      {/* ── Download + copy buttons ─────────────────────────────────────── */}
      <div className="mt-4 flex items-center gap-3">
        <a
          href={exportUrl}
          download
          className="border border-black dark:border-gray-500 px-3 py-1 text-sm no-underline hover:bg-gray-100 dark:hover:bg-gray-700 inline-block"
        >
          Download CSV
        </a>
        {/* Copy selected rows as TSV (summary + pop columns) — shown when ≥1 row clicked */}
        {selectedRows.length > 0 && (
          <button
            onClick={handleCopySelected}
            disabled={copyState === "loading"}
            className="border border-black dark:border-gray-500 px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copyState === "loading"
              ? "Copying..."
              : copyState === "done"
              ? "Copied!"
              : `Copy ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"}`}
          </button>
        )}

        {/* View in IGV — shown only when exactly one row is selected AND the
            parent (App.tsx) has provided the onViewInIgv callback.
            A single locus string ("chr3:100,234,500-100,235,000") is what
            igv's browser.search() accepts; multiple rows would be ambiguous. */}
        {selectedRows.length === 1 && onViewInIgv && (
          <button
            onClick={() => {
              const row = selectedRows[0];
              onViewInIgv(`${row.chrom}:${row.start}-${row.end}`);
            }}
            className="border border-black dark:border-gray-500 px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            View in IGV
          </button>
        )}
      </div>

      {/* ── Data table ─────────────────────────────────────────────────── */}
      {/* data.results comes directly from the API — no client-side filtering.
          data.total is the server-side count of matching rows, so pagination
          is always accurate.
          onSelectionChange: driven by row clicks (blue highlight) in DataTable.
          renderExpandedRow: shows an inline PopFreqTable when a checkbox is checked. */}
      <DataTable
        columns={columns}
        data={data?.results ?? []}
        total={data?.total ?? 0}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPaginationChange={handlePaginationChange}
        isLoading={isLoading}
        onSelectionChange={setSelectedRows}
        renderExpandedRow={(row) => <PopFreqTable id={(row as InsertionSummary).id} />}
      />
    </div>
  );
}
