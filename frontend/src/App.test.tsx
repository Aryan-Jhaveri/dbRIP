/**
 * Tests for the root App component.
 *
 * WHAT THESE TESTS VERIFY:
 *   - The app renders without crashing
 *   - The title and all three tab buttons appear
 *   - Clicking a tab switches the visible content
 *
 * NOTE: The Interactive Search tab renders the real InteractiveSearch component,
 * which uses the useInsertions hook. We mock that hook here so App tests don't
 * need a running API server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { useInsertions } from "./hooks/useInsertions";

// Mock useInsertions so the InteractiveSearch page doesn't make real API calls
vi.mock("./hooks/useInsertions");

/** Helper: wraps a component in QueryClientProvider. */
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("App", () => {
  // Set up the mock before each test
  beforeEach(() => {
    vi.mocked(useInsertions).mockReturnValue({
      data: { total: 0, limit: 50, offset: 0, results: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useInsertions>);
  });

  it("renders the title", () => {
    renderWithProviders(<App />);
    expect(
      screen.getByText(/dbRIP — Database of Retrotransposon Insertion Polymorphism/i)
    ).toBeInTheDocument();
  });

  it("renders all three tab buttons", () => {
    renderWithProviders(<App />);
    expect(screen.getByText("Interactive Search")).toBeInTheDocument();
    expect(screen.getByText("File Search")).toBeInTheDocument();
    expect(screen.getByText("Batch Search")).toBeInTheDocument();
  });

  it("shows Interactive Search content by default", () => {
    renderWithProviders(<App />);
    // The InteractiveSearch page renders a search bar
    expect(screen.getByPlaceholderText(/regex, case-insensitive/i)).toBeInTheDocument();
  });

  it("switches to File Search tab when clicked", () => {
    renderWithProviders(<App />);
    fireEvent.click(screen.getByText("File Search"));
    expect(screen.getByText(/upload a BED\/CSV\/TSV file/i)).toBeInTheDocument();
  });

  it("switches to Batch Search tab when clicked", () => {
    renderWithProviders(<App />);
    fireEvent.click(screen.getByText("Batch Search"));
    // BatchSearch renders checkbox groups — check for one of them
    expect(screen.getByText("By Category:")).toBeInTheDocument();
  });
});
