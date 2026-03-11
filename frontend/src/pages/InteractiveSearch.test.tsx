/**
 * Tests for the InteractiveSearch page.
 *
 * WHAT THESE TESTS VERIFY:
 *   - Renders the search bar, download link, column headers
 *   - Shows "Loading..." while data is being fetched
 *   - Renders the data table with results after loading
 *   - Shows error message when API returns no data
 *   - Client-side filtering: search hides non-matching rows after debounce
 *   - Client-side filtering: search status message shows match count
 *   - Client-side filtering: Clear button resets search and shows all rows
 *   - Client-side filtering: rows are NOT filtered before debounce fires
 *
 * HOW MOCKING WORKS:
 *   We mock the useInsertions hook (not the fetch call) because:
 *     1. We're testing the page component, not the API client
 *     2. Mocking the hook lets us control loading/data/error states precisely
 *     3. No need to set up a fake server or intercept HTTP requests
 *
 *   vi.mock("../hooks/useInsertions") replaces the real hook with a mock.
 *   vi.mocked(useInsertions).mockReturnValue(...) sets what the mock returns.
 *
 * WHY vi.advanceTimersByTime(300)?
 *   The search bar has a 300ms debounce — typing "ALU" doesn't immediately
 *   filter results. We use Vitest's fake timers to skip past the debounce
 *   so we can test the filtered state without waiting real milliseconds.
 *   act() wraps the timer advance because it triggers a React state update.
 *
 * WHAT'S NOT TESTED HERE:
 *   - The regex filter logic itself — that's in utils/filterRowsByRegex.test.ts
 *   - API calls — the hook is mocked, so no HTTP happens
 *   - Pagination — tested in DataTable.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InteractiveSearch from "./InteractiveSearch";
import { useInsertions } from "../hooks/useInsertions";

// Mock the useInsertions hook so we don't need a real API
vi.mock("../hooks/useInsertions");

/** Helper: wraps component in QueryClientProvider. */
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

/**
 * Sample API response for testing.
 * Two ALU insertions with different annotations (TERMINATOR vs INTRONIC)
 * so we can verify that searching "INTRONIC" hides the TERMINATOR row.
 */
const mockData = {
  total: 2,
  limit: 50,
  offset: 0,
  results: [
    {
      id: "A0000001",
      dataset_id: "dbrip_v1",
      assembly: "hg38",
      chrom: "chr1",
      start: 758508,
      end: 758509,
      strand: "+",
      me_category: "Non-reference",
      me_type: "ALU",
      rip_type: "NonLTR_SINE",
      me_subtype: "AluYc1",
      me_length: 281,
      tsd: "AAAAATTACCATTGTC",
      annotation: "TERMINATOR",
      variant_class: "Very Rare",
    },
    {
      id: "A0000002",
      dataset_id: "dbrip_v1",
      assembly: "hg38",
      chrom: "chr1",
      start: 852829,
      end: 852830,
      strand: "+",
      me_category: "Non-reference",
      me_type: "ALU",
      rip_type: "NonLTR_SINE",
      me_subtype: "AluYb6_2",
      me_length: 281,
      tsd: "AAAAAAGTAATA",
      annotation: "INTRONIC",
      variant_class: "Very Rare",
    },
  ],
};

describe("InteractiveSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use fake timers so we can control the 300ms debounce
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic rendering tests ───────────────────────────────────────────

  it("renders the search bar", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);
    expect(screen.getByPlaceholderText(/regex, case-insensitive/i)).toBeInTheDocument();
  });

  it("renders the Download CSV link", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);
    expect(screen.getByText("Download CSV")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders data in the table", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);
    // Check that insertion IDs appear in the table
    expect(screen.getByText("A0000001")).toBeInTheDocument();
    expect(screen.getByText("A0000002")).toBeInTheDocument();
    // Check a column header
    expect(screen.getByText("ME Type")).toBeInTheDocument();
    // Check pagination label
    expect(screen.getByText("Showing 1 to 2 of 2 entries")).toBeInTheDocument();
  });

  it("shows error message when API returns no data", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);
    expect(screen.getByText(/unable to load data/i)).toBeInTheDocument();
  });

  // ── Client-side search filtering tests ──────────────────────────────

  it("filters table rows after debounce fires", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);

    // Both rows visible before search
    expect(screen.getByText("A0000001")).toBeInTheDocument();
    expect(screen.getByText("A0000002")).toBeInTheDocument();

    // Type "INTRONIC" in the search bar
    const searchInput = screen.getByPlaceholderText(/regex, case-insensitive/i);
    fireEvent.change(searchInput, { target: { value: "INTRONIC" } });

    // Advance past the 300ms debounce so searchQuery updates
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Now only the INTRONIC row should be visible
    expect(screen.queryByText("A0000001")).not.toBeInTheDocument();
    expect(screen.getByText("A0000002")).toBeInTheDocument();
  });

  it("shows search status message with match count", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);

    // Type a search term and wait for debounce
    const searchInput = screen.getByPlaceholderText(/regex, case-insensitive/i);
    fireEvent.change(searchInput, { target: { value: "INTRONIC" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Status message should show "1 of 2 rows on this page"
    expect(screen.getByText(/1 of 2 rows on this page/)).toBeInTheDocument();
  });

  it("shows Clear button after debounce and clears search when clicked", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);

    // Type a search and wait for debounce
    const searchInput = screen.getByPlaceholderText(/regex, case-insensitive/i);
    fireEvent.change(searchInput, { target: { value: "INTRONIC" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Clear button should be visible
    const clearButton = screen.getByText("Clear");
    expect(clearButton).toBeInTheDocument();

    // Click Clear — both rows should reappear
    fireEvent.click(clearButton);
    // Advance timers for the debounce on the cleared input
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("A0000001")).toBeInTheDocument();
    expect(screen.getByText("A0000002")).toBeInTheDocument();
  });

  it("does not filter before debounce fires", () => {
    vi.mocked(useInsertions).mockReturnValue({
      data: mockData,
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);

    renderWithProviders(<InteractiveSearch />);

    // Type "INTRONIC" but DON'T advance timers
    const searchInput = screen.getByPlaceholderText(/regex, case-insensitive/i);
    fireEvent.change(searchInput, { target: { value: "INTRONIC" } });

    // Both rows should still be visible (debounce hasn't fired)
    expect(screen.getByText("A0000001")).toBeInTheDocument();
    expect(screen.getByText("A0000002")).toBeInTheDocument();
  });
});
