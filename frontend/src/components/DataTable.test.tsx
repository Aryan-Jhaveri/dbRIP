/**
 * Tests for the DataTable component.
 *
 * WHAT THESE TESTS VERIFY:
 *   - Renders column headers correctly
 *   - Renders row data in cells
 *   - Shows "Showing X to Y of Z entries" pagination label
 *   - Shows "No results found." when data is empty
 *   - Shows "Loading..." when isLoading is true
 *   - Disables Previous button on first page
 *   - Disables Next button on last page
 *   - Calls onPaginationChange when Next/Previous is clicked
 *   - Calls onPaginationChange with page 0 when page size changes
 *
 * HOW THESE TESTS WORK:
 *   We render the DataTable with mock data and column definitions, then
 *   assert on the rendered output using screen queries. The onPaginationChange
 *   callback is a Vitest mock function (vi.fn()) so we can verify it was
 *   called with the right arguments.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DataTable from "./DataTable";
import type { ColumnDef } from "@tanstack/react-table";

// ── Test data ────────────────────────────────────────────────────────────

/** Simple row type for testing — not insertion-specific. */
interface TestRow {
  id: string;
  name: string;
  value: number;
}

/** Column definitions for the test data. */
const columns: ColumnDef<TestRow, unknown>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "value", header: "Value" },
];

/** Sample rows for testing. */
const sampleData: TestRow[] = [
  { id: "A001", name: "Alpha", value: 10 },
  { id: "A002", name: "Beta", value: 20 },
  { id: "A003", name: "Gamma", value: 30 },
];

/** No-op callback for tests that don't care about pagination changes. */
const noop = vi.fn();

// ── Tests ────────────────────────────────────────────────────────────────

describe("DataTable", () => {
  it("renders column headers", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={3}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("renders row data", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={3}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.getByText("A001")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows pagination label", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={100}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.getByText("Showing 1 to 10 of 100 entries")).toBeInTheDocument();
  });

  it("shows 'No results found.' when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        total={0}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("shows 'Loading...' when isLoading is true", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        total={0}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
        isLoading={true}
      />
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("disables Previous button on first page", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={100}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.getByText("Previous")).toBeDisabled();
  });

  it("disables Next button on last page", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={30}
        pageIndex={2}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("calls onPaginationChange when Next is clicked", () => {
    const onChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={100}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("Next"));
    // Should request page 1 with same page size
    expect(onChange).toHaveBeenCalledWith(1, 10);
  });

  it("calls onPaginationChange when Previous is clicked", () => {
    const onChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={100}
        pageIndex={2}
        pageSize={10}
        onPaginationChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("Previous"));
    // Should request page 1 (back from page 2)
    expect(onChange).toHaveBeenCalledWith(1, 10);
  });

  it("resets to page 0 when page size changes", () => {
    const onChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={100}
        pageIndex={3}
        pageSize={25}
        onPaginationChange={onChange}
      />
    );
    // Change page size from 25 to 50
    fireEvent.change(screen.getByDisplayValue("25"), { target: { value: "50" } });
    // Should reset to page 0 with new page size
    expect(onChange).toHaveBeenCalledWith(0, 50);
  });

  // ── Select All / Deselect All button ──────────────────────────────────

  it("shows Select All button when onSelectionChange is provided", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={3}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
        onSelectionChange={vi.fn()}
      />
    );
    expect(screen.getByText("Select All")).toBeInTheDocument();
  });

  it("does not show Select All button when onSelectionChange is omitted", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={3}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
      />
    );
    expect(screen.queryByText("Select All")).not.toBeInTheDocument();
  });

  it("does not show Select All button when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        total={0}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
        onSelectionChange={vi.fn()}
      />
    );
    expect(screen.queryByText("Select All")).not.toBeInTheDocument();
  });

  it("calls onSelectionChange with all rows when Select All is clicked", () => {
    const onSelection = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={3}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
        onSelectionChange={onSelection}
      />
    );
    fireEvent.click(screen.getByText("Select All"));
    // onSelectionChange should be called with all 3 rows
    expect(onSelection).toHaveBeenCalledWith(sampleData);
  });

  it("toggles to Deselect All after selecting all, then clears selection", () => {
    const onSelection = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        total={3}
        pageIndex={0}
        pageSize={10}
        onPaginationChange={noop}
        onSelectionChange={onSelection}
      />
    );
    // Click Select All → button should change to Deselect All
    fireEvent.click(screen.getByText("Select All"));
    expect(screen.getByText("Deselect All")).toBeInTheDocument();

    // Click Deselect All → should clear and button goes back to Select All
    fireEvent.click(screen.getByText("Deselect All"));
    expect(screen.getByText("Select All")).toBeInTheDocument();
    // Last call should be with empty array (deselected)
    expect(onSelection).toHaveBeenLastCalledWith([]);
  });
});
