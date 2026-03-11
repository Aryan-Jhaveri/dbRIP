/**
 * Tests for the root App component.
 *
 * WHAT THESE TESTS VERIFY:
 *   - The app renders without crashing
 *   - The title and all three tab buttons appear
 *   - Clicking a tab switches the visible content
 *
 * HOW TESTING WORKS:
 *   We use Vitest (test runner) + React Testing Library (renders components
 *   and simulates user interactions). Tests run in jsdom, a simulated browser
 *   environment — no real browser needed.
 *
 *   render(<App />) mounts the component into jsdom.
 *   screen.getByText("...") finds elements by their visible text.
 *   fireEvent.click() simulates a user clicking a button.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

/**
 * Helper: wraps a component in QueryClientProvider so TanStack Query works.
 * Every component that uses useQuery() needs this wrapper in tests.
 */
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("App", () => {
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
    expect(screen.getByText(/server-side paginated data table/i)).toBeInTheDocument();
  });

  it("switches to File Search tab when clicked", () => {
    renderWithProviders(<App />);
    fireEvent.click(screen.getByText("File Search"));
    expect(screen.getByText(/upload a BED\/CSV\/TSV file/i)).toBeInTheDocument();
  });

  it("switches to Batch Search tab when clicked", () => {
    renderWithProviders(<App />);
    fireEvent.click(screen.getByText("Batch Search"));
    expect(screen.getByText(/filter by category/i)).toBeInTheDocument();
  });
});
