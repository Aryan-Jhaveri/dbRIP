/**
 * Root application component — the top-level layout for the dbRIP frontend.
 *
 * WHAT THIS FILE DOES:
 *   Renders the page header, tab navigation, and the currently active tab.
 *   This is a single-page app (SPA) — there's no server-side page rendering.
 *   All three "pages" (Interactive Search, File Search, Batch Search) are
 *   rendered client-side by swapping which component is visible.
 *
 * WHY TABS INSTEAD OF ROUTES?
 *   The Shiny app uses tabs, and bioinformaticians are used to that layout.
 *   We could use React Router for URL-based navigation later, but tabs are
 *   simpler and match the existing UX. No extra dependency needed.
 *
 * DESIGN:
 *   - Black and white, no logos, no images
 *   - System font stack (set in index.css)
 *   - Plain text title and description
 */

import { useState, useCallback, useEffect } from "react";
import InteractiveSearch from "./pages/InteractiveSearch";
import FileSearch from "./pages/FileSearch";
import BatchSearch from "./pages/BatchSearch";
import IgvViewer from "./pages/IgvViewer";
import ApiRef from "./pages/ApiRef";
import CliRef from "./pages/CliRef";

/**
 * Tab identifiers — used to track which tab is currently active.
 * Using a union type instead of an enum because it's simpler and
 * TypeScript can still enforce that only valid values are used.
 */
type Tab = "interactive" | "file" | "batch" | "igv" | "api-ref" | "cli-ref";

/**
 * Tab metadata — label shown in the tab bar, and which tab it corresponds to.
 */
const TABS: { id: Tab; label: string }[] = [
  { id: "interactive", label: "Interactive Search" },
  { id: "file", label: "File Search" },
  { id: "batch", label: "Batch Search" },
  { id: "igv", label: "IGV Viewer" },
  { id: "api-ref", label: "API Reference" },
  { id: "cli-ref", label: "CLI Reference" },
];

export default function App() {
  // Track which tab is currently active (default: Interactive Search)
  const [activeTab, setActiveTab] = useState<Tab>("interactive");

  // ── Dark mode state ────────────────────────────────────────────────────
  //
  // Initialize from localStorage so the user's preference survives page reloads.
  // If no preference is saved yet (first visit), fall back to the OS setting via
  // window.matchMedia so new visitors automatically get the mode they expect.
  //
  // The initializer function runs once at mount — we wrap it in useState's lazy
  // init form (() => ...) so it doesn't re-run on every render.
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("darkMode");
    if (saved !== null) return saved === "true";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Apply or remove the "dark" class on <html> whenever darkMode changes.
  // The @variant rule in index.css makes all dark: Tailwind classes respond to
  // this class, so toggling it here cascades through the entire component tree.
  // We also persist the choice to localStorage so it survives refreshes.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => setDarkMode((d) => !d), []);

  // Locus passed to the IGV viewer when the user clicks "View in IGV" in
  // InteractiveSearch. Stored here (not in IgvViewer) because App.tsx owns
  // the tab-switching logic — it needs to switch to the igv tab AND pass the
  // locus in the same action.
  const [igvLocus, setIgvLocus] = useState<string | null>(null);

  // Called by InteractiveSearch when the user clicks "View in IGV" on a row.
  // Switches to the IGV tab and sets the locus prop on IgvViewer.
  const handleViewInIgv = useCallback((locus: string) => {
    setIgvLocus(locus);
    setActiveTab("igv");
  }, []);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      {/*
        * The header row uses flex with justify-between so the dark mode toggle
        * button sits in the top-right corner on all screen sizes.
        * min-w-0 on the text block prevents it from overflowing on small screens.
        */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">
            dbRIP — Database of Retrotransposon Insertion Polymorphism
          </h1>
          <p className="mt-1 text-sm">
            44,984 TE insertions across 33 populations (1000 Genomes, GRCh38).
            For issues, contact: tl21xq@brocku.ca
          </p>
        </div>

        {/* Dark mode toggle — persists preference in localStorage.
            shrink-0 prevents the button from being squished by the title text. */}
        <button
          onClick={toggleDarkMode}
          className="shrink-0 border border-black dark:border-gray-500 px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-100 whitespace-nowrap"
          aria-label="Toggle dark mode"
        >
          {darkMode ? "Light mode" : "Dark mode"}
        </button>
      </div>

      {/* ── Tab navigation ─────────────────────────────────────────────── */}
      {/*
        * overflow-x-auto + whitespace-nowrap lets the 6 tabs scroll horizontally
        * on narrow screens (phones) instead of wrapping and breaking the border
        * design. On desktop all tabs are visible at once.
        */}
      <nav className="mt-6 border-b border-black dark:border-gray-500 overflow-x-auto">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-semibold border border-black dark:border-gray-500 border-b-0 cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-white text-black hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div className="border border-t-0 border-black dark:border-gray-500 p-4 dark:bg-gray-900">
        {activeTab === "interactive" && <InteractiveSearch onViewInIgv={handleViewInIgv} />}
        {activeTab === "file" && <FileSearch />}
        {activeTab === "batch" && <BatchSearch />}

        {/*
          WHY IgvViewer USES display:none INSTEAD OF CONDITIONAL RENDERING:
          The other tabs use `{activeTab === "..." && <Component />}` which
          unmounts the component when its tab is inactive. This is fine for
          data tables (they re-fetch on mount).

          IgvViewer is different: igv.js takes ~1-2 seconds to initialize,
          and any BAM/BED tracks the user loaded would be lost on unmount.
          Keeping IgvViewer mounted (but hidden) preserves the browser state
          across tab switches — the user can navigate in InteractiveSearch
          and return to IGV with their tracks still loaded.

          The `locus` prop is still updated when the user clicks "View in IGV",
          which triggers navigation even while the tab is hidden.
        */}
        <div style={{ display: activeTab === "igv" ? "block" : "none" }}>
          <IgvViewer locus={igvLocus ?? undefined} />
        </div>

        {activeTab === "api-ref" && <ApiRef />}
        {activeTab === "cli-ref" && <CliRef />}
      </div>
    </div>
  );
}
