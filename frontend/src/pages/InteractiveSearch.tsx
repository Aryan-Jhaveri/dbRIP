/**
 * InteractiveSearch — the main search page (Tab 1).
 *
 * WHAT THIS PAGE DOES:
 *   Replicates the Shiny app's "Interactive Search" tab:
 *     1. A global search bar (regex-capable, case-insensitive)
 *     2. A data table showing insertion results with server-side pagination
 *     3. A download button for exporting filtered results as CSV
 *
 * HOW SEARCH WORKS (CLIENT-SIDE FILTERING):
 *   The search bar applies a regex filter across ALL columns of the currently
 *   loaded page of results. This matches how Shiny's DataTable works — the
 *   DataTable widget does client-side regex search on whatever rows are loaded.
 *
 *   Why client-side instead of server-side?
 *     - The API design spec doesn't include a "search"
 *       query param on GET /v1/insertions. Adding one would mean designing regex
 *       support in SQLAlchemy, which is a bigger architectural decision.
 *     - Client-side filtering on the current page is the simplest useful step.
 *       It covers the main use case: "I see a page of results, let me narrow
 *       them down by typing ALU or INTRONIC."
 *     - If we later need full-database search, we'd add a server-side param.
 *       That's a separate API design decision, not a frontend concern.
 *
 *   How the regex works:
 *     - User types a pattern (e.g. "ALU|SVA" or "chr1")
 *     - We compile it as a case-insensitive RegExp
 *     - Every row is tested: we stringify each cell value and check if ANY
 *       cell in that row matches the regex
 *     - If the regex is invalid (e.g. unclosed bracket "["), we catch the
 *       error and show all rows — no crash, no error message. The user just
 *       sees unfiltered results while they're still typing.
 *
 *   The debounce (300ms) prevents re-filtering on every keystroke.
 *
 * PAGINATION + SEARCH INTERACTION:
 *   Server-side pagination is still in charge of which rows we fetch from the
 *   API. Client-side search only filters within those fetched rows. This means:
 *     - "Showing X of Y fetched (Z total)" reflects both levels
 *     - The DataTable receives filteredRows (not raw API results)
 *     - The total passed to DataTable is the server-side total (for page
 *       navigation), but the displayed row count may be less if search is active
 *
 * HOW IT CONNECTS TO OTHER FILES:
 *   - useInsertions (hooks/useInsertions.ts) → fetches from FastAPI
 *   - DataTable (components/DataTable.tsx) → renders the table
 *   - listInsertions (api/client.ts) → the actual fetch call
 *   - InsertionSummary (types/insertion.ts) → TypeScript type for rows
 *   - buildExportUrl (api/client.ts) → builds the CSV download link
 *   - filterRowsByRegex (utils/filterRowsByRegex.ts) → client-side regex filter
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
 *   page load. If we need pop freqs in the table later, we'd add a new
 *   API endpoint that includes them.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import DataTable from "../components/DataTable";
import { useInsertions } from "../hooks/useInsertions";
import { buildExportUrl } from "../api/client";
import { filterRowsByRegex } from "../utils/filterRowsByRegex";
import type { InsertionSummary } from "../types/insertion";

// ── Column definitions ──────────────────────────────────────────────────
// Each column maps an accessorKey (field name from the API response)
// to a header label shown in the table. Order matches the Shiny app.

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

// ── Component ────────────────────────────────────────────────────────────

export default function InteractiveSearch() {
  // ── State ────────────────────────────────────────────────────────────
  // pageIndex: current page (0-based), controls which slice of data the API returns
  // pageSize: rows per page, sent as "limit" to the API
  // searchInput: what the user is typing (updates on every keystroke)
  // searchQuery: the debounced value actually used for filtering
  //   (we debounce so we're not running regex on every single keystroke)
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Debounce search ──────────────────────────────────────────────────
  // Wait 300ms after the user stops typing before applying the filter.
  // This prevents running the regex filter on every single keystroke,
  // which matters when there are 50-1000 rows to scan.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Fetch data ───────────────────────────────────────────────────────
  // Server-side pagination: the API returns `pageSize` rows starting at
  // `pageIndex * pageSize`. Search/filtering happens client-side AFTER
  // these rows arrive — the API knows nothing about the search bar.
  const { data, isLoading } = useInsertions({
    limit: pageSize,
    offset: pageIndex * pageSize,
  });

  // ── Client-side filtering ────────────────────────────────────────────
  // Apply the regex search to the current page of results.
  // useMemo ensures we only re-filter when the data or search changes,
  // not on every render (e.g. when pagination buttons re-render).
  const filteredResults = useMemo(
    () => filterRowsByRegex(data?.results ?? [], searchQuery),
    [data?.results, searchQuery]
  );

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
  // Build a download link for the current filters (CSV format).
  // NOTE: This downloads ALL rows from the API (the export endpoint has
  // no limit). Client-side search does NOT affect the download — the user
  // gets the full dataset. This matches Shiny's behavior where the
  // download button exports everything, not just filtered rows.
  const exportUrl = buildExportUrl("csv");

  return (
    <div>
      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-4">
        <label className="text-sm font-semibold">Search:</label>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="e.g. ALU|SVA|INTRONIC (regex, case-insensitive)"
          className="border border-black px-2 py-1 text-sm flex-1 max-w-md"
        />
        {searchQuery && (
          <button
            onClick={() => {
              setSearchInput("");
              setSearchQuery("");
            }}
            className="border border-black px-2 py-1 text-sm cursor-pointer hover:bg-gray-100"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Search status ──────────────────────────────────────────────── */}
      {/* Show how many rows matched the search out of how many were loaded.
          Only visible when a search is active and data is loaded. */}
      {searchQuery && data && !isLoading && (
        <p className="text-xs mb-2">
          Showing {filteredResults.length} of {data.results.length} rows on this
          page matching &quot;{searchQuery}&quot;
        </p>
      )}

      {/* ── Error display ──────────────────────────────────────────────── */}
      {!isLoading && !data && (
        <p className="text-sm mb-4">
          Unable to load data. Make sure the API is running (uvicorn app.main:app --reload).
        </p>
      )}

      {/* ── Data table ─────────────────────────────────────────────────── */}
      {/* We pass filteredResults (not raw data.results) so the table only
          shows rows that match the search. The total is still the server-side
          total so pagination navigation works correctly across all pages. */}
      <DataTable
        columns={columns}
        data={filteredResults}
        total={data?.total ?? 0}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPaginationChange={handlePaginationChange}
        isLoading={isLoading}
      />

      {/* ── Download button ────────────────────────────────────────────── */}
      <div className="mt-4">
        <a
          href={exportUrl}
          download
          className="border border-black px-3 py-1 text-sm no-underline hover:bg-gray-100 inline-block"
        >
          Download CSV
        </a>
      </div>
    </div>
  );
}
