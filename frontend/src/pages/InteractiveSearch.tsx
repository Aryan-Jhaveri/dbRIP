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
 *   page load. If we need pop freqs in the table later, we'd add a new
 *   API endpoint that includes them.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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

// ── Fixed-value filter options ───────────────────────────────────────────
// These match the exact values stored in the database.

const ME_TYPES = ["ALU", "LINE1", "SVA", "HERVK", "PP"];
const ME_CATEGORIES = ["Reference", "Non-reference"];
const ANNOTATIONS = [
  "PROMOTER", "5_UTR", "EXON", "INTRONIC", "3_UTR",
  "TERMINATOR", "INTERGENIC",
];

// ── Population options ───────────────────────────────────────────────────
// 5 super-populations + 26 sub-populations from the 1000 Genomes Project.
// Values match the population codes stored in the pop_frequencies table.

const POPULATIONS = [
  // Super-populations
  { value: "AFR", label: "AFR — African" },
  { value: "AMR", label: "AMR — Ad Mixed American" },
  { value: "EAS", label: "EAS — East Asian" },
  { value: "EUR", label: "EUR — European" },
  { value: "SAS", label: "SAS — South Asian" },
  // Sub-populations
  { value: "ACB", label: "ACB — African Caribbean in Barbados" },
  { value: "ASW", label: "ASW — Americans of African Ancestry in SW USA" },
  { value: "BEB", label: "BEB — Bengali in Bangladesh" },
  { value: "CDX", label: "CDX — Chinese Dai in Xishuangbanna, China" },
  { value: "CEU", label: "CEU — Utah Residents (CEPH) with Northern and Western European Ancestry" },
  { value: "CHB", label: "CHB — Han Chinese in Beijing, China" },
  { value: "CHS", label: "CHS — Southern Han Chinese" },
  { value: "CLM", label: "CLM — Colombians in Medellin, Colombia" },
  { value: "ESN", label: "ESN — Esan in Nigeria" },
  { value: "FIN", label: "FIN — Finnish in Finland" },
  { value: "GBR", label: "GBR — British in England and Scotland" },
  { value: "GIH", label: "GIH — Gujarati Indian in Houston, TX" },
  { value: "GWD", label: "GWD — Gambian in Western Division, The Gambia" },
  { value: "IBS", label: "IBS — Iberian Populations in Spain" },
  { value: "ITU", label: "ITU — Indian Telugu in the UK" },
  { value: "JPT", label: "JPT — Japanese in Tokyo, Japan" },
  { value: "KHV", label: "KHV — Kinh in Ho Chi Minh City, Vietnam" },
  { value: "LWK", label: "LWK — Luhya in Webuye, Kenya" },
  { value: "MSL", label: "MSL — Mende in Sierra Leone" },
  { value: "MXL", label: "MXL — Mexican Ancestry in Los Angeles, CA" },
  { value: "PEL", label: "PEL — Peruvians in Lima, Peru" },
  { value: "PJL", label: "PJL — Punjabi in Lahore, Pakistan" },
  { value: "PUR", label: "PUR — Puerto Ricans in Puerto Rico" },
  { value: "STU", label: "STU — Sri Lankan Tamil in the UK" },
  { value: "TSI", label: "TSI — Toscani in Italy" },
  { value: "YRI", label: "YRI — Yoruba in Ibadan, Nigeria" },
];

// ── Min-frequency options ────────────────────────────────────────────────
// Preset allele frequency thresholds. "" means "no filter" (show all).
// Values are numbers that map directly to the API's min_freq param.

const MIN_FREQ_OPTIONS = [
  { value: "", label: "Any frequency" },
  { value: "0.01", label: "≥ 1%" },
  { value: "0.05", label: "≥ 5%" },
  { value: "0.10", label: "≥ 10%" },
  { value: "0.50", label: "≥ 50%" },
];

// ── Component ────────────────────────────────────────────────────────────

export default function InteractiveSearch() {
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

  // Currently selected rows (for the "Copy selected" button).
  const [selectedRows, setSelectedRows] = useState<InsertionSummary[]>([]);

  // Copy button state machine: idle → loading (fetching pop data) → done (flash "Copied!") → idle
  const [copyState, setCopyState] = useState<"idle" | "loading" | "done">("idle");

  // Which insertion ID (if any) has its population popup open.
  // Clicking the same ID again closes the popup (toggle behaviour).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Viewport-relative position where the popup should appear (anchored to the clicked ID button).
  // null when no popup is open.
  const [popupAnchor, setPopupAnchor] = useState<{ top: number; left: number } | null>(null);

  // Ref on the popup div for click-outside detection.
  const popupRef = useRef<HTMLDivElement>(null);

  // ── Column definitions ────────────────────────────────────────────────
  // Defined inside the component (with useMemo) so the ID cell renderer can
  // read selectedId from state and call setSelectedId. If we defined columns
  // outside the component, those callbacks wouldn't have access to state.
  //
  // useMemo re-creates the array only when selectedId changes, not on every render.
  const columns = useMemo<ColumnDef<InsertionSummary, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        header: "ID",
        // Custom cell renderer: make the ID a clickable button that opens a
        // floating popup showing population frequencies. Bold = currently open.
        // stopPropagation prevents the document click-outside handler from
        // immediately closing the popup that this click just opened.
        cell: ({ getValue }) => {
          const id = getValue() as string;
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (id === selectedId) {
                  setSelectedId(null);
                  setPopupAnchor(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  // Clamp left so the popup doesn't overflow the right edge of the viewport.
                  const POPUP_WIDTH = 640;
                  const left = Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 16);
                  setPopupAnchor({ top: rect.bottom + 6, left });
                  setSelectedId(id);
                }
              }}
              className={`underline cursor-pointer text-left ${id === selectedId ? "font-bold" : ""}`}
              title="Click to view population frequencies"
            >
              {id}
            </button>
          );
        },
      },
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
    ],
    [selectedId]
  );

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

  // ── Close popup on Escape or click-outside ───────────────────────────
  useEffect(() => {
    if (!selectedId) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setPopupAnchor(null);
      }
    };
    // Click-outside: close if the click lands outside the popup div.
    // The ID button uses stopPropagation() so it never reaches this listener.
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSelectedId(null);
        setPopupAnchor(null);
      }
    };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [selectedId]);

  // ── Fetch population detail ───────────────────────────────────────────
  // When the user clicks an ID, fetch the full InsertionDetail (which includes
  // the populations array). useInsertion skips the fetch when selectedId is null.
  const { data: detailData, isLoading: detailLoading } = useInsertion(selectedId);

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
  //   so if the user already clicked an ID to view its popup, that detail is
  //   already cached and the copy is instant for that row.
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
          className="border border-black px-2 py-1 text-sm flex-1 max-w-md"
        />
        {searchInput && (
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
          className="border border-black px-2 py-1 text-sm"
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
          className="border border-black px-2 py-1 text-sm disabled:opacity-40"
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
            className="border border-black px-2 py-1 text-sm h-24"
          >
            {ME_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
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
            className="border border-black px-2 py-1 text-sm h-24"
          >
            {ME_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
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
            className="border border-black px-2 py-1 text-sm h-24"
          >
            {ANNOTATIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
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
          className="border border-black px-3 py-1 text-sm no-underline hover:bg-gray-100 inline-block"
        >
          Download CSV
        </a>
        {/* Copy selected rows as TSV (summary + pop columns) — shown when ≥1 row checked */}
        {selectedRows.length > 0 && (
          <button
            onClick={handleCopySelected}
            disabled={copyState === "loading"}
            className="border border-black px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copyState === "loading"
              ? "Copying..."
              : copyState === "done"
              ? "Copied!"
              : `Copy ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      {/* ── Data table ─────────────────────────────────────────────────── */}
      {/* data.results comes directly from the API — no client-side filtering.
          data.total is the server-side count of matching rows, so pagination
          is always accurate. */}
      <DataTable
        columns={columns}
        data={data?.results ?? []}
        total={data?.total ?? 0}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPaginationChange={handlePaginationChange}
        isLoading={isLoading}
        onSelectionChange={setSelectedRows}
      />

      {/* ── Population frequencies popup ─────────────────────────────────── */}
      {/* Floating card anchored to the clicked ID cell via position:fixed.
          Uses viewport-relative coordinates from getBoundingClientRect() so it
          stays correctly positioned even when the table is scrolled.
          Closes on: Close button, Escape key, or clicking outside the card. */}
      {selectedId && popupAnchor && (
        <div
          ref={popupRef}
          style={{ position: "fixed", top: popupAnchor.top, left: popupAnchor.left, zIndex: 50, width: 640 }}
          className="bg-white border border-black shadow-lg p-3"
        >
          {/* Header row: ID label + Close button */}
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">
              Population Frequencies — {selectedId}
            </span>
            <button
              onClick={() => { setSelectedId(null); setPopupAnchor(null); }}
              className="text-sm border border-black px-2 py-0.5 cursor-pointer hover:bg-gray-100 ml-4 flex-shrink-0"
            >
              Close
            </button>
          </div>

          {/* Content: loading spinner, or horizontal table */}
          {detailLoading ? (
            <p className="text-sm">Loading...</p>
          ) : detailData ? (
            /*
             * Horizontal layout: population codes as <th> in the header row,
             * AF values as <td> in the data row. With 33 columns this is wider
             * than the card, so overflow-x: auto lets the user scroll sideways.
             * Each cell is intentionally compact (px-2 py-0.5) to fit more columns.
             */
            <div className="overflow-x-auto">
              <table className="border-collapse border border-black text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-white border-b border-black">
                    {detailData.populations.map((pf) => (
                      <th
                        key={pf.population}
                        className="border border-black px-2 py-0.5 font-semibold text-center"
                      >
                        {pf.population}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {detailData.populations.map((pf) => (
                      <td
                        key={pf.population}
                        className="border border-black px-2 py-0.5 text-center"
                      >
                        {pf.af !== null ? pf.af.toFixed(4) : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
