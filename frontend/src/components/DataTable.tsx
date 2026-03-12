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
 * TWO INDEPENDENT INTERACTION SYSTEMS:
 *
 *   1. ROW CLICK (anywhere except the checkbox cell):
 *      Single-click toggles a blue highlight on that row. Shift+click extends
 *      the selection to a contiguous range. The highlighted rows are reported
 *      to the parent via onSelectionChange so the Copy button knows what to copy.
 *
 *   2. CHECKBOX (shown only when renderExpandedRow is provided):
 *      Single-click shows/hides a nested <tr> below that row (populated by
 *      renderExpandedRow). Shift+click expands or collapses a range at once.
 *      The header checkbox expands/collapses all rows on the current page.
 *
 *   The two systems are intentionally independent — clicking a checkbox does
 *   NOT highlight the row, and clicking a row does NOT expand/collapse it.
 *
 * PROPS:
 *   columns            — TanStack ColumnDef array describing columns
 *   data               — Array of row objects for the current page
 *   total              — Total number of rows matching filters (from API)
 *   pageIndex          — Current page number (0-based)
 *   pageSize           — Number of rows per page
 *   onPaginationChange — Called when user changes page or page size
 *   isLoading          — Whether data is currently being fetched
 *   onSelectionChange  — Called when row-click selection changes (blue highlight)
 *   renderExpandedRow  — If provided, enables checkboxes that expand a nested row
 */

import { useState, useEffect, useRef } from "react";
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

  /**
   * Called whenever the set of row-click-highlighted rows changes.
   * Receives the array of original row objects that are currently selected.
   * Omit this prop to hide the blue-highlight behaviour entirely.
   */
  onSelectionChange?: (selectedRows: TData[]) => void;

  /**
   * If provided, a checkbox column appears. When a row's checkbox is checked,
   * this function is called with that row's data and should return a React node
   * to render in a nested <tr> below that row (e.g. a population frequency table).
   */
  renderExpandedRow?: (row: TData) => React.ReactNode;
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
  renderExpandedRow,
}: DataTableProps<TData>) {
  // Calculate total number of pages
  const pageCount = Math.ceil(total / pageSize);

  // "Go to page" input — tracks the raw text so the user can type freely.
  // We only jump when they press Enter or blur the field, and we clamp to [1, pageCount].
  const [goToInput, setGoToInput] = useState("");

  // ── Two independent selection sets ─────────────────────────────────────
  //
  // selectedIds — IDs of rows highlighted blue (row-click system).
  //   Used to drive onSelectionChange → Copy button in the parent.
  //
  // expandedIds — IDs of rows with their nested detail row showing (checkbox system).
  //   Controls whether renderExpandedRow is rendered below each row.
  //
  // Both are Sets of TanStack row IDs (strings like "0", "1", "2"...).
  // We use Sets instead of plain objects because membership tests are O(1)
  // and "add / delete / has" is cleaner than setting booleans in a Record.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Shift-click anchors — one per interaction system.
  // These are refs (not state) because updating them should NOT trigger a re-render.
  // They remember the last row the user clicked so we know where the shift-range starts.
  const lastRowClickRef = useRef<number | null>(null);
  const lastCheckboxClickRef = useRef<number | null>(null);

  // ── Drag-to-select state ───────────────────────────────────────────────
  // isDraggingRef: true while the user holds the mouse button down over the tbody.
  // dragModeRef:   "select" if the drag started on an unselected row (adds rows),
  //                "deselect" if it started on a selected row (removes rows).
  // This lets the user sweep through multiple rows in one motion to select or
  // deselect a batch, rather than clicking each row individually.
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<"select" | "deselect">("select");

  // Stop dragging when the mouse button is released anywhere in the document.
  // We listen on the document (not the table) so releasing outside the table
  // also ends the drag — prevents getting "stuck" in drag mode.
  useEffect(() => {
    const handleMouseUp = () => { isDraggingRef.current = false; };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Reset both sets and both anchors whenever the page data changes.
  // If we didn't do this, row IDs from the previous page would linger in the sets,
  // and the next page's rows (which reuse the same IDs "0"–"49") would appear
  // pre-selected or pre-expanded.
  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    lastRowClickRef.current = null;
    lastCheckboxClickRef.current = null;
  }, [data]);

  // ── Create TanStack Table instance ────────────────────────────────────
  // manualPagination = true tells TanStack "don't paginate locally,
  // the server handles it — just render what I give you".
  // We no longer use TanStack's row-selection feature; we manage our own
  // selectedIds Set so row-click (blue highlight) and checkbox (expand) can
  // be completely independent of each other.
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

  const rows = table.getRowModel().rows;

  // Notify parent whenever row-click selection changes.
  // We map row IDs back to original TData objects using the current row model.
  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(
      rows.filter((r) => selectedIds.has(r.id)).map((r) => r.original)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  // Calculate which rows are currently showing (for the "Showing X–Y of Z" label)
  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, total);

  // Total column count, including the optional checkbox column.
  // Used for colSpan in loading/empty state cells.
  const totalCols = columns.length + (renderExpandedRow ? 1 : 0);

  // ── Row mousedown handler (blue highlight / copy system) ─────────────
  //
  // We use onMouseDown (not onClick) so drag-to-select can start immediately
  // without waiting for mouseup. preventDefault() stops the browser from
  // starting a text-selection drag, which would interfere with row selection.
  //
  // Normal press:    toggle this row; set dragMode for the subsequent drag.
  // Shift+press:     add all rows in [lastRowClickRef, this row] range to selectedIds.
  // After either:    update lastRowClickRef so the next shift-press has a valid anchor.
  function handleRowMouseDown(e: React.MouseEvent, rowId: string, rowIndex: number) {
    if (e.button !== 0) return; // ignore right-click / middle-click
    e.preventDefault(); // prevent browser text-selection drag

    isDraggingRef.current = true;

    if (e.shiftKey && lastRowClickRef.current !== null) {
      // Shift+press: apply the TARGET row's current state to the whole range.
      //
      // Standard UX (Gmail, Windows Explorer, Finder):
      //   - Shift+clicking an UNSELECTED row → SELECT everything in the range
      //   - Shift+clicking a SELECTED row    → DESELECT everything in the range
      //
      // This mirrors what the user sees: the row they're clicking on flips, and
      // the range catches up to match. The anchor row is just a boundary marker.
      const lo = Math.min(lastRowClickRef.current, rowIndex);
      const hi = Math.max(lastRowClickRef.current, rowIndex);
      const shouldSelect = !selectedIds.has(rowId); // target row's state decides direction
      dragModeRef.current = shouldSelect ? "select" : "deselect";
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => {
          if (r.index >= lo && r.index <= hi) {
            if (shouldSelect) next.add(r.id);
            else next.delete(r.id);
          }
        });
        return next;
      });
    } else {
      // Normal press: toggle this row; drag mode follows the initial toggle direction.
      const isSelected = selectedIds.has(rowId);
      dragModeRef.current = isSelected ? "deselect" : "select";
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (isSelected) next.delete(rowId);
        else next.add(rowId);
        return next;
      });
    }
    lastRowClickRef.current = rowIndex;
  }

  // ── Row mouseenter handler (drag continuation) ────────────────────────
  //
  // While the mouse button is held (isDraggingRef=true), entering a new row
  // applies the dragMode that was set on the initial mousedown. This lets the
  // user sweep through rows in one motion to select or deselect them in bulk.
  // We return the previous Set unchanged if it's already in the right state to
  // avoid unnecessary re-renders (React bails out if the reference is the same).
  function handleRowMouseEnter(rowId: string) {
    if (!isDraggingRef.current) return;
    setSelectedIds((prev) => {
      if (dragModeRef.current === "select") {
        if (prev.has(rowId)) return prev;
        const next = new Set(prev);
        next.add(rowId);
        return next;
      } else {
        if (!prev.has(rowId)) return prev;
        const next = new Set(prev);
        next.delete(rowId);
        return next;
      }
    });
  }

  // ── Checkbox click handler (expand / collapse system) ─────────────────
  //
  // e.stopPropagation() prevents the click from bubbling up to the <tr>'s
  // onClick handler — we don't want checking a box to also highlight the row.
  //
  // Normal click: toggles this row in expandedIds.
  // Shift+click: if the current row was expanded → collapse the whole range;
  //              if it was collapsed → expand the whole range.
  //   (The direction matches the current row's state before the click.)
  function handleCheckboxClick(e: React.MouseEvent, rowId: string, rowIndex: number) {
    e.stopPropagation();
    const isCurrentlyExpanded = expandedIds.has(rowId);

    if (e.shiftKey && lastCheckboxClickRef.current !== null) {
      const lo = Math.min(lastCheckboxClickRef.current, rowIndex);
      const hi = Math.max(lastCheckboxClickRef.current, rowIndex);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => {
          if (r.index >= lo && r.index <= hi) {
            if (isCurrentlyExpanded) next.delete(r.id);
            else next.add(r.id);
          }
        });
        return next;
      });
    } else {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      });
    }
    lastCheckboxClickRef.current = rowIndex;
  }

  return (
    <div>
      {/* ── Pagination controls ────────────────────────────────────────── */}
      {/*
        * flex-wrap lets the controls break into two lines on narrow screens
        * instead of overflowing. The "showing X–Y" label and the navigation
        * controls each get their own line on mobile, side-by-side on desktop.
        */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {/* Showing X–Y of Z */}
        <span>
          {total === 0
            ? "No results"
            : `Showing ${firstRow} to ${lastRow} of ${total.toLocaleString()} entries`}
        </span>

        {/* Page size + navigation — also wraps internally via flex-wrap */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {/* Page size dropdown */}
          <label>
            Show{" "}
            <select
              value={pageSize}
              onChange={(e) => {
                // When page size changes, reset to first page
                onPaginationChange(0, Number(e.target.value));
              }}
              className="border border-black dark:border-gray-500 px-1 py-0.5"
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
            className="border border-black dark:border-gray-500 px-2 py-0.5 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
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
                className="border border-black dark:border-gray-500 px-1 py-0.5 w-14 text-center"
              />
            </label>
          )}

          {/* Next button */}
          <button
            onClick={() => onPaginationChange(pageIndex + 1, pageSize)}
            disabled={pageIndex >= pageCount - 1}
            className="border border-black dark:border-gray-500 px-2 py-0.5 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-black dark:border-gray-500 text-sm">
          {/* Table header */}
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-black dark:border-gray-500 bg-white dark:bg-gray-800">
                {/* Checkbox column header — only shown when renderExpandedRow is provided.
                    This checkbox controls expanding/collapsing ALL rows on this page:
                    - checked = all rows expanded
                    - indeterminate = some (but not all) rows expanded
                    - unchecked = no rows expanded */}
                {renderExpandedRow && (
                  <th className="border border-black dark:border-gray-500 px-2 py-1 text-center align-middle">
                    {/* "Pop Freq" label stacked above the expand-all checkbox */}
                    <span className="block text-xs font-semibold whitespace-nowrap mb-0.5">
                      Pop Freq
                    </span>
                    <input
                      type="checkbox"
                      checked={expandedIds.size === rows.length && rows.length > 0}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            expandedIds.size > 0 && expandedIds.size < rows.length;
                      }}
                      onChange={() => {
                        if (expandedIds.size === rows.length) {
                          // All expanded → collapse all
                          setExpandedIds(new Set());
                        } else {
                          // Some or none expanded → expand all rows on this page
                          setExpandedIds(new Set(rows.map((r) => r.id)));
                        }
                      }}
                      aria-label="Expand all rows"
                    />
                  </th>
                )}
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold whitespace-nowrap"
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
                  colSpan={totalCols}
                  className="border border-black dark:border-gray-500 px-2 py-4 text-center"
                >
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={totalCols}
                  className="border border-black dark:border-gray-500 px-2 py-4 text-center"
                >
                  No results found.
                </td>
              </tr>
            ) : (
              // flatMap lets us conditionally insert the expanded detail row
              // immediately after each data row without nesting arrays manually.
              rows.flatMap((row) => {
                const isSelected = selectedIds.has(row.id);
                const isExpanded = expandedIds.has(row.id);

                // The main data row.
                // - cursor-pointer signals the whole row is clickable (for blue highlight).
                // - onMouseDown starts selection / drag; onMouseEnter continues a drag.
                // - bg-blue-200/dark:bg-blue-900 when selected, blue hover when not.
                const dataRow = (
                  <tr
                    key={row.id}
                    onMouseDown={(e) => handleRowMouseDown(e, row.id, row.index)}
                    onMouseEnter={() => handleRowMouseEnter(row.id)}
                    className={`border-b border-black dark:border-gray-600 cursor-pointer ${
                      isSelected
                        ? "bg-blue-200 dark:bg-blue-900"
                        : "hover:bg-blue-50 dark:hover:bg-blue-950"
                    }`}
                  >
                    {/* Per-row expand checkbox — only when renderExpandedRow is provided.
                        onMouseDown stopPropagation prevents the row's drag handler from
                        firing when the user clicks the checkbox. The checkbox uses its own
                        handleCheckboxClick (onClick) for toggle + shift-range logic. */}
                    {renderExpandedRow && (
                      <td
                        className="border border-black dark:border-gray-500 px-2 py-1 w-8 text-center"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isExpanded}
                          // onChange no-op: React requires this on a controlled checkbox.
                          // All logic is in onClick (handleCheckboxClick).
                          onChange={() => {}}
                          onClick={(e) => handleCheckboxClick(e, row.id, row.index)}
                          aria-label={`Expand row ${row.id}`}
                          title="Click to view population frequencies. Shift+click to expand a range."
                        />
                      </td>
                    )}
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="border border-black dark:border-gray-500 px-2 py-1 whitespace-nowrap"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );

                // If this row's checkbox is checked, render the expanded detail row
                // directly below it. colSpan spans all columns (including the checkbox
                // column) so the nested content is full-width.
                if (isExpanded && renderExpandedRow) {
                  return [
                    dataRow,
                    <tr key={`${row.id}-expanded`}>
                      <td
                        colSpan={totalCols}
                        className="border border-black dark:border-gray-500 bg-gray-50 dark:bg-gray-800 px-4 py-2"
                      >
                        {renderExpandedRow(row.original)}
                      </td>
                    </tr>,
                  ];
                }

                return [dataRow];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
