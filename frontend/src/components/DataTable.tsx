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

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
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
}: DataTableProps<TData>) {
  // Calculate total number of pages
  const pageCount = Math.ceil(total / pageSize);

  // Create TanStack Table instance
  // manualPagination = true tells TanStack "don't paginate locally,
  // the server handles it — just render what I give you"
  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      pagination: { pageIndex, pageSize },
    },
    manualPagination: true,
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
        <table className="w-full border-collapse border border-black text-sm">
          {/* Table header */}
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-black bg-white">
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
                  colSpan={columns.length}
                  className="border border-black px-2 py-4 text-center"
                >
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="border border-black px-2 py-4 text-center"
                >
                  No results found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-black hover:bg-gray-50">
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
