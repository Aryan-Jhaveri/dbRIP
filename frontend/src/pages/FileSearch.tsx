/**
 * FileSearch — upload a BED/CSV/TSV file and find overlapping insertions (Tab 2).
 *
 * WHAT THIS PAGE DOES:
 *   1. User drops or selects a BED/CSV/TSV file containing genomic regions
 *   2. User optionally sets a window (±bp to extend each region)
 *   3. On submit, the file is uploaded to POST /v1/insertions/file-search
 *   4. The API parses the file, finds overlapping TE insertions, and returns
 *      a paginated list
 *   5. Results are shown in a DataTable with pagination and a Download button
 *
 * SUPPORTED FILE FORMATS:
 *   BED  — tab-separated, no header, columns: chrom start end [...]
 *   CSV  — comma-separated with a header row (chrom/chr, start, end columns)
 *   TSV  — same as CSV but tab-separated
 *
 * WINDOW PARAMETER:
 *   Extends each query region by ±window bp. For example, with window=500,
 *   a region chr1:1000-2000 becomes chr1:500-2500 for overlap matching.
 *   This is useful for finding insertions near (but not inside) a region.
 *
 * HOW IT CONNECTS TO OTHER FILES:
 *   - fileSearch (api/client.ts) → POST /v1/insertions/file-search
 *   - DataTable (components/DataTable.tsx) → renders the results
 *   - InsertionSummary (types/insertion.ts) → type for result rows
 *   - App.tsx → mounts this component when the "File Search" tab is active
 *
 * STATE MACHINE:
 *   idle        → user hasn't submitted yet (or cleared results)
 *   loading     → fetch in flight
 *   error       → API returned an error or file was unreadable
 *   results     → data arrived, showing table
 */

import { useState, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import DataTable from "../components/DataTable";
import { fileSearch } from "../api/client";
import type { PaginatedResponse, InsertionSummary } from "../types/insertion";

// ── Column definitions ───────────────────────────────────────────────────
// Same columns as InteractiveSearch — these are the InsertionSummary fields.

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

export default function FileSearch() {
  // ── State ────────────────────────────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [windowBp, setWindowBp] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // ── Drag-and-drop handlers ───────────────────────────────────────────
  // We use the HTML drag-and-drop API to let users drop files onto the zone.
  // The dragover handler must call preventDefault() to allow dropping.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setSelectedFile(dropped);
      setData(null);
      setError(null);
    }
  }, []);

  // ── File input handler ───────────────────────────────────────────────
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (picked) {
      setSelectedFile(picked);
      setData(null);
      setError(null);
    }
  }, []);

  // ── Submit (fetch page) ──────────────────────────────────────────────
  // Fetches the given page from the API. Called on initial submit and on
  // pagination changes. We keep selectedFile and windowBp in state so
  // pagination requests can reuse them without re-uploading.
  const fetchPage = useCallback(
    async (pi: number, ps: number) => {
      if (!selectedFile) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await fileSearch(selectedFile, windowBp, ps, pi * ps);
        setData(result);
        setPageIndex(pi);
        setPageSize(ps);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedFile, windowBp]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      fetchPage(0, pageSize);
    },
    [fetchPage, pageSize]
  );

  const handlePaginationChange = useCallback(
    (newPageIndex: number, newPageSize: number) => {
      fetchPage(newPageIndex, newPageSize);
    },
    [fetchPage]
  );

  return (
    <div>
      <p className="text-sm mb-4">
        Upload a BED, CSV, or TSV file to find insertions overlapping each listed region.
      </p>

      {/* ── Upload form ────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="mb-4">
        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed border-black dark:border-gray-500 px-6 py-8 text-center text-sm cursor-pointer mb-3 ${
            isDragging ? "bg-gray-100 dark:bg-gray-700" : "bg-white dark:bg-gray-900"
          }`}
          onClick={() => document.getElementById("file-input")?.click()}
        >
          {selectedFile ? (
            <span>
              Selected: <strong>{selectedFile.name}</strong> (
              {(selectedFile.size / 1024).toFixed(1)} KB)
            </span>
          ) : (
            <span>
              Drop a BED / CSV / TSV file here, or click to browse
            </span>
          )}
        </div>

        {/* Hidden file input — triggered by clicking the drop zone */}
        <input
          id="file-input"
          type="file"
          accept=".bed,.csv,.tsv,.txt"
          onChange={handleFileInput}
          className="hidden"
        />

        {/* Window input */}
        <div className="flex items-center gap-3 mb-3">
          <label className="text-sm font-semibold" htmlFor="window-input">
            Window (±bp):
          </label>
          <input
            id="window-input"
            type="number"
            min={0}
            value={windowBp}
            onChange={(e) => setWindowBp(Math.max(0, parseInt(e.target.value) || 0))}
            className="border border-black dark:border-gray-500 px-2 py-1 text-sm w-24"
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">
            Extend each region by this many base pairs on each side
          </span>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!selectedFile || isLoading}
          className="border border-black dark:border-gray-500 px-4 py-1 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? "Searching…" : "Search"}
        </button>
      </form>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <p className="text-sm mb-4 border border-black dark:border-gray-500 px-3 py-2">
          Error: {error}
        </p>
      )}

      {/* ── Results ────────────────────────────────────────────────────── */}
      {data && (
        <>
          {/* Download button — links to the export endpoint with the same
              file, so the user can get all matching rows (not just one page).
              NOTE: The export endpoint doesn't support file-search yet, so
              we provide a download of what's visible instead via a blob URL.
              For now we show the count and note full export is TODO. */}
          <div className="mb-3 text-sm">
            Found <strong>{data.total.toLocaleString()}</strong> overlapping insertions.
          </div>

          <DataTable
            columns={columns}
            data={data.results}
            total={data.total}
            pageIndex={pageIndex}
            pageSize={pageSize}
            onPaginationChange={handlePaginationChange}
            isLoading={isLoading}
          />
        </>
      )}
    </div>
  );
}
