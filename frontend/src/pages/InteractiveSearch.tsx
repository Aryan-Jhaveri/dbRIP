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

import { useState, useEffect, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import DataTable from "../components/DataTable";
import { useInsertions } from "../hooks/useInsertions";
import { buildExportUrl } from "../api/client";
import type { InsertionSummary } from "../types/insertion";

// Column header labels in the same order as the columns array below.
// Used to build the TSV header when copying selected rows.
const COLUMN_HEADERS = [
  "ID", "Chromosome", "Start", "End", "Category", "ME Type",
  "RIP Type", "ME Subtype", "ME Length", "Strand", "TSD",
  "Annotation", "Variant Class",
];

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
  // Feedback state for copy button ("Copied!" flash).
  const [copyFeedback, setCopyFeedback] = useState(false);

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

  // ── Copy selected rows as TSV ─────────────────────────────────────────
  // Formats the selected InsertionSummary rows as tab-separated text with a
  // header row, then writes it to the clipboard. Shows "Copied!" for 1.5s.
  const handleCopySelected = useCallback(() => {
    const fields: (keyof InsertionSummary)[] = [
      "id", "chrom", "start", "end", "me_category", "me_type",
      "rip_type", "me_subtype", "me_length", "strand", "tsd",
      "annotation", "variant_class",
    ];
    const header = COLUMN_HEADERS.join("\t");
    const rows = selectedRows.map((row) =>
      fields.map((f) => row[f] ?? "").join("\t")
    );
    navigator.clipboard.writeText([header, ...rows].join("\n")).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    });
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
        {/* Copy selected rows as TSV — only shown when at least one row is checked */}
        {selectedRows.length > 0 && (
          <button
            onClick={handleCopySelected}
            className="border border-black px-3 py-1 text-sm cursor-pointer hover:bg-gray-100"
          >
            {copyFeedback ? "Copied!" : `Copy ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"}`}
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


    </div>
  );
}
