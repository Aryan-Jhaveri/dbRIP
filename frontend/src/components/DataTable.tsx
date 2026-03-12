/**
 * DataTable — a generic, reusable table component with server-side pagination.
 *
 * WHAT THIS COMPONENT DOES:
 *   Renders a plain HTML <table> with pagination controls. It does NOT fetch
 *   data itself — the parent component provides data and column definitions.
 *   When the user changes page or page size, it calls onPaginationChange so
 *   the parent can refetch from the API.
 *
 * WHY IS IT GENERIC?
 *   This table doesn't know about insertions, frequencies, or biology. It just
 *   renders rows and columns. This means we can reuse it for:
 *     - Interactive Search results
 *     - File Search results
 *     - Batch Search results
 *     - Any future table in the app
 *
 * WHY SERVER-SIDE PAGINATION?
 *   With 44,984 rows, we can't load everything into the browser at once.
 *   Instead, the API returns one page at a time (e.g. 50 rows), and the table
 *   shows pagination controls to navigate between pages. TanStack Table's
 *   "manual" mode handles this — it doesn't try to paginate locally.
 *
 * HOW TANSTACK TABLE WORKS:
 *   TanStack Table is "headless" — it provides the logic (pagination, sorting,
 *   filtering) but NOT the UI. We write our own HTML/JSX for the table. This
 *   gives us full control over styling (black and white, no frills).
 *
 *   Key concepts:
 *     - ColumnDef: describes one column (header text, how to read the cell value)
 *     - useReactTable(): creates a table instance with all the logic
 *     - table.getHeaderGroups(): returns header rows to render <th> elements
 *     - table.getRowModel().rows: returns data rows to render <td> elements
 *
 * PROPS:
 *   columns     — TanStack ColumnDef array describing columns
 *   data        — Array of row objects for the current page
 *   total       — Total number of rows matching filters (from API)
 *   pageIndex   — Current page number (0-based)
 *   pageSize    — Number of rows per page
 *   onPaginationChange — Called when user changes page or page size
 *   isLoading   — Whether data is currently being fetched
 */

import { useState, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";

// ── Props interface ──────────────────────────────────────────────────────

export interface DataTableProps<TData> {
  /** Column definitions — describes what columns to show and how to read cell values. */
  columns: ColumnDef<TData, unknown>[];

  /** Row data for the current page (from the API response). */
  data: TData[];

  /** Total number of rows matching the current filters (from API response.total). */
  total: number;

  /** Current page number (0-based). Page 0 = first page. */
  pageIndex: number;

  /** Number of rows per page (e.g. 10, 25, 50, 100). */
  pageSize: number;

  /**
   * Called when the user navigates to a different page or changes page size.
   * The parent should update its state and refetch from the API.
   */
  onPaginationChange: (pageIndex: number, pageSize: number) => void;

  /** Whether data is currently being fetched (shows a loading indicator). */
  isLoading?: boolean;

  /**
   * Called whenever the set of checked rows changes.
   * Receives the array of original row objects that are currently selected.
   * Omit this prop to hide checkboxes entirely.
   */
  onSelectionChange?: (selectedRows: TData[]) => void;
}

// ── Available page sizes ─────────────────────────────────────────────────
// These match the options in the Shiny app's DataTable (10, 25, 50, 100).
const PAGE_SIZES = [25, 50, 100, 500, 1000];

// ── Component ────────────────────────────────────────────────────────────

export default function DataTable<TData>({
  columns,
  data,
  total,
  pageIndex,
  pageSize,
  onPaginationChange,
  isLoading = false,
  onSelectionChange,
}: DataTableProps<TData>) {
  // Calculate total number of pages
  const pageCount = Math.ceil(total / pageSize);

  // "Go to page" input — tracks the raw text so the user can type freely.
  // We only jump when they press Enter or blur the field, and we clamp to [1, pageCount].
  const [goToInput, setGoToInput] = useState("");

  // Row selection state: a map of row id → boolean.
  // Only populated when the parent passes onSelectionChange.
  // We reset selection whenever the page data changes so stale row IDs
  // from a previous page don't linger.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  useEffect(() => {
    setRowSelection({});
  }, [data]);

  // Tracks which row was last clicked (for shift-click range selection).
  // A ref (not state) because updating it shouldn't trigger a re-render.
  const lastClickedIndexRef = useRef<number | null>(null);

  // Notify parent whenever selection changes.
  useEffect(() => {
    if (!onSelectionChange) return;
    // getSelectedRowModel() returns the currently-selected rows based on
    // the current rowSelection state and data.  We pull .original to get
    // the raw TData objects (not the TanStack Row wrapper).
    onSelectionChange(
      table.getSelectedRowModel().rows.map((r) => r.original)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  // Create TanStack Table instance
  // manualPagination = true tells TanStack "don't paginate locally,
  // the server handles it — just render what I give you"
  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      pagination: { pageIndex, pageSize },
      // Only pass rowSelection state when the parent wants selection.
      ...(onSelectionChange ? { rowSelection } : {}),
    },
    manualPagination: true,
    enableRowSelection: !!onSelectionChange,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
  });

  // Calculate which rows are currently showing (for the "Showing X–Y of Z" label)
  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, total);

  return (
    <div>
           {/* ── Pagination controls ────────────────────────────────────────── */}
      <div className="mt-2 flex items-center justify-between text-sm">
        {/* Left side: showing X–Y of Z */}
        <span>
          {total === 0
            ? "No results"
            : `Showing ${firstRow} to ${lastRow} of ${total.toLocaleString()} entries`}
        </span>

        {/* Right side: page size selector + prev/next buttons */}
        <div className="flex items-center gap-2">
          {/* Page size dropdown */}
          <label>
            Show{" "}
            <select
              value={pageSize}
              onChange={(e) => {
                // When page size changes, reset to first page
                onPaginationChange(0, Number(e.target.value));
              }}
              className="border border-black px-1 py-0.5"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>{" "}
            entries
          </label>

          {/* Previous button */}
          <button
            onClick={() => onPaginationChange(pageIndex - 1, pageSize)}
            disabled={pageIndex === 0}
            className="border border-black px-2 py-0.5 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            Previous
          </button>

          {/* Current page indicator */}
          <span>
            Page {total === 0 ? 0 : pageIndex + 1} of {pageCount}
          </span>

          {/* Go to page input — lets users jump to an arbitrary page number
              without clicking Next/Previous repeatedly. We clamp the entered
              value to [1, pageCount] so out-of-range inputs don't break anything. */}
          {pageCount > 1 && (
            <label className="flex items-center gap-1">
              Go to:
              <input
                type="number"
                min={1}
                max={pageCount}
                value={goToInput}
                onChange={(e) => setGoToInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const page = Math.min(Math.max(1, parseInt(goToInput) || 1), pageCount);
                    onPaginationChange(page - 1, pageSize);
                    setGoToInput("");
                  }
                }}
                onBlur={() => {
                  if (goToInput !== "") {
                    const page = Math.min(Math.max(1, parseInt(goToInput) || 1), pageCount);
                    onPaginationChange(page - 1, pageSize);
                    setGoToInput("");
                  }
                }}
                className="border border-black px-1 py-0.5 w-14 text-center"
              />
            </label>
          )}

          {/* Next button */}
          <button
            onClick={() => onPaginationChange(pageIndex + 1, pageSize)}
            disabled={pageIndex >= pageCount - 1}
            className="border border-black px-2 py-0.5 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        {/*
         * colSpan for the loading/empty states must account for the extra
         * checkbox column when row selection is enabled.
         */}
        <table className="w-full border-collapse border border-black text-sm">
          {/* Table header */}
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-black bg-white">
                {/* Checkbox column header — only shown when selection is enabled */}
                {onSelectionChange && (
                  <th className="border border-black px-2 py-1 w-8">
                    {/* Select-all checkbox */}
                    <input
                      type="checkbox"
                      checked={table.getIsAllRowsSelected()}
                      ref={(el) => {
                        if (el) el.indeterminate = table.getIsSomeRowsSelected();
                      }}
                      onChange={table.getToggleAllRowsSelectedHandler()}
                      aria-label="Select all rows"
                    />
                  </th>
                )}
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border border-black px-2 py-1 text-left font-semibold whitespace-nowrap"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* Table body */}
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectionChange ? 1 : 0)}
                  className="border border-black px-2 py-4 text-center"
                >
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectionChange ? 1 : 0)}
                  className="border border-black px-2 py-4 text-center"
                >
                  No results found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-black hover:bg-gray-50 ${
                    row.getIsSelected() ? "bg-gray-100" : ""
                  }`}
                >
                  {/* Per-row checkbox — only shown when selection is enabled.
                      Supports shift-click to select a contiguous range of rows.
                      Normal click toggles the individual row; shift-click selects
                      every row between the last-clicked row and this one. */}
                  {onSelectionChange && (
                    <td className="border border-black px-2 py-1 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={row.getIsSelected()}
                        // We handle all selection logic in onClick, so onChange is a no-op.
                        // This is required because React treats <input checked> as a
                        // controlled element — without onChange it warns about read-only.
                        onChange={() => {}}
                        onClick={(e) => {
                          if (e.shiftKey && lastClickedIndexRef.current !== null) {
                            // Shift+click: select all rows from lastClickedIndex to this row.
                            // Math.min/max handles clicking above or below the anchor row.
                            const lo = Math.min(lastClickedIndexRef.current, row.index);
                            const hi = Math.max(lastClickedIndexRef.current, row.index);
                            setRowSelection((prev) => {
                              const next = { ...prev };
                              table.getRowModel().rows.forEach((r) => {
                                if (r.index >= lo && r.index <= hi) {
                                  next[r.id] = true;
                                }
                              });
                              return next;
                            });
                          } else {
                            // Normal click: toggle just this row.
                            row.getToggleSelectedHandler()(e);
                          }
                          // Always update the anchor for the next potential shift-click.
                          lastClickedIndexRef.current = row.index;
                        }}
                        aria-label={`Select row ${row.id}`}
                        title="Click to select. Shift+click to select a range."
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="border border-black px-2 py-1 whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
