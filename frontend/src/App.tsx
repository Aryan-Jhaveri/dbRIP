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

import { useState, useCallback } from "react";
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
      <h1 className="text-2xl font-bold">
        dbRIP — Database of Retrotransposon Insertion Polymorphism
      </h1>
      <p className="mt-1 text-sm">
        44,984 TE insertions across 33 populations (1000 Genomes, GRCh38).
        For issues, contact: tl21xq@brocku.ca
      </p>

      {/* ── Tab navigation ─────────────────────────────────────────────── */}
      <nav className="mt-6 border-b border-black flex gap-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-semibold border border-black border-b-0 cursor-pointer ${
              activeTab === tab.id
                ? "bg-black text-white"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div className="border border-t-0 border-black p-4">
        {activeTab === "interactive" && <InteractiveSearch />}
        {activeTab === "file" && <FileSearch />}
        {activeTab === "batch" && <BatchSearch />}
        {activeTab === "api-ref" && <ApiRef />}
        {activeTab === "cli-ref" && <CliRef />}
      </div>
    </div>
  );
}
