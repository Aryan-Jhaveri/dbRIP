/**
 * IgvViewer — embedded IGV (Integrative Genomics Viewer) browser page.
 *
 * WHAT THIS PAGE DOES:
 *   Embeds igv.js — the same viewer used in the desktop IGV application,
 *   running entirely in the browser with no server-side processing.
 *   Three entry points:
 *     1. Standalone  — open this tab, type a locus, click Go
 *     2. File upload — bioinformatician loads their own BAM, BED, or VCF file
 *     3. From search — App.tsx passes a `locus` prop when the user clicks
 *                      "View in IGV" on a row in InteractiveSearch
 *
 * WHAT IS IGV.js?
 *   igv.js is a JavaScript port of the Integrative Genomics Viewer (Broad
 *   Institute). It renders:
 *     - Aligned reads from BAM/CRAM files as colored stacked reads
 *     - Genomic feature intervals from BED/GFF files as color blocks
 *     - Genetic variants from VCF files as colored variant calls
 *   … in the context of a reference genome (hg38 or hg19).
 *
 *   Typical bioinformatics workflow here:
 *     1. User finds a TE insertion in InteractiveSearch (e.g. chr3:100,234,500)
 *     2. Clicks "View in IGV" → this page opens at that locus
 *     3. User uploads their own BAM file to compare their reads to the insertion
 *
 * WHY useRef (NOT useState) FOR THE BROWSER INSTANCE?
 *   igv creates and manages real DOM nodes. We use refs (not state) so that:
 *     - igv can mutate the container div without React interfering
 *     - Calling browser.search() or browser.loadTrack() does NOT trigger a
 *       React re-render (those calls happen outside React's rendering cycle)
 *   If the browser were stored in useState, every setState call would cause
 *   a re-render and React might try to replace igv's DOM nodes.
 *
 * REACT STRICTMODE DOUBLE-INITIALIZATION:
 *   In development, React's <StrictMode> runs useEffect twice (mount →
 *   unmount → mount) to catch side effects. igv crashes if createBrowser()
 *   is called on a container that already has a browser. The guard
 *   `if (browserRef.current !== null) return` stops the second call.
 *
 * HOW IT CONNECTS TO OTHER FILES:
 *   - App.tsx          → passes the `locus` prop when "View in IGV" is clicked
 *   - InteractiveSearch.tsx → calls the onViewInIgv callback with a locus string
 *   - types/igv.d.ts   → TypeScript type shim for the igv npm package
 */

import { useState, useRef, useEffect } from "react";
import igv from "igv";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The two built-in reference genomes supported by igv.js.
 * Using a union type (not string) so the compiler catches typos.
 *
 *   hg38 — GRCh38, the current human reference. dbRIP uses this.
 *   hg19 — GRCh37, the previous reference. Many older datasets still use it.
 */
type Genome = "hg38" | "hg19";

/**
 * The three genomic file formats a bioinformatician would upload here.
 *
 *   bam — Binary Alignment Map (aligned sequencing reads). Requires a .bai
 *         index for igv to do random-access reads on the file.
 *   bed — Browser Extensible Data (genomic intervals / annotations). Small
 *         files can be loaded without an index.
 *   vcf — Variant Call Format (genetic variants). Small files need no index.
 */
type TrackType = "bam" | "bed" | "vcf";

/**
 * One entry in the "Loaded tracks" list below the browser.
 * We store just the name so we can call browser.removeTrackByName()
 * and update the list UI.
 */
interface TrackEntry {
  name: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface IgvViewerProps {
  /**
   * Optional genomic locus to navigate to on arrival, e.g. "chr3:100,234,500-100,235,000".
   * Set by App.tsx when the user clicks "View in IGV" in InteractiveSearch.
   * When this prop changes value, the browser navigates to the new locus.
   *
   * Note: if the browser hasn't finished initializing when this prop arrives
   * (igv.createBrowser is async), navigation is silently skipped. The user
   * can click "View in IGV" again once igv has loaded.
   */
  locus?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function IgvViewer({ locus }: IgvViewerProps) {
  // ── Refs ───────────────────────────────────────────────────────────────────
  //
  // Both refs use useRef (not useState) because changes to refs do NOT
  // trigger a React re-render. igv manipulates the DOM directly, and we
  // control the browser imperatively — React should stay out of the way.

  // The DOM node igv.createBrowser() mounts its canvas into.
  const containerRef = useRef<HTMLDivElement>(null);

  // The live igv Browser instance. Null until createBrowser resolves.
  // Accessed via methods like browserRef.current.search("chr1:1000-2000").
  const browserRef = useRef<igv.Browser | null>(null);

  // ── State ──────────────────────────────────────────────────────────────────
  //
  // These values drive the UI controls above the browser. They ARE stored in
  // state (not refs) because the controls must re-render when they change.

  // Currently selected reference genome.
  const [genome, setGenome] = useState<Genome>("hg38");

  // The locus text field — updated by the user typing, by the "Go" button,
  // and automatically when the `locus` prop changes (cross-tab navigation).
  const [locusInput, setLocusInput] = useState("chr1:1,000,000-1,001,000");

  // ── Track upload form state ────────────────────────────────────────────────

  // Which file type the user is about to add (determines which pickers appear).
  const [trackType, setTrackType] = useState<TrackType>("bam");

  // Optional display name for the track label inside igv.
  const [trackName, setTrackName] = useState("");

  // The selected file(s). mainFile is the .bam/.bed/.vcf; indexFile is .bai (BAM only).
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [indexFile, setIndexFile] = useState<File | null>(null);

  // Whether a track load is in progress (disables the Add button while loading).
  const [isAddingTrack, setIsAddingTrack] = useState(false);

  // Non-fatal error message shown below the Add button (file format errors, etc.).
  const [loadError, setLoadError] = useState<string | null>(null);

  // List of track names currently loaded in igv — used to render Remove buttons.
  const [tracks, setTracks] = useState<TrackEntry[]>([]);

  // ── Browser initialization ─────────────────────────────────────────────────
  //
  // We call igv.createBrowser once, right after the component mounts.
  // The empty `[]` dependency array means "run this effect exactly once."
  //
  // DO NOT add `genome` or `locusInput` to the dependency array:
  //   - genome changes require destroying and recreating the browser (see reinitialize())
  //   - locusInput changes are handled by calling browser.search() directly
  // Running the effect again would create a second browser on top of the first.
  useEffect(() => {
    if (!containerRef.current) return;

    // ── StrictMode guard ────────────────────────────────────────────────────
    // React's development <StrictMode> runs effects twice: it mounts, runs the
    // effect, unmounts (cleanup), then mounts and runs the effect again. This
    // is intentional — it helps catch effects that aren't properly cleaned up.
    //
    // igv.createBrowser crashes if called on a container that already has a
    // browser attached. The second invocation would see a non-null browserRef
    // only if the cleanup didn't run (which shouldn't happen in practice), but
    // this guard is the standard safety check for igv + StrictMode.
    if (browserRef.current !== null) return;

    // ── Async race flag ──────────────────────────────────────────────────────
    // igv.createBrowser is asynchronous. If the component unmounts (user
    // switches tabs) before createBrowser resolves, the `.then()` callback
    // would try to assign to browserRef.current — but the component is gone.
    // The `cancelled` flag lets the callback clean up and bail out instead.
    let cancelled = false;

    igv
      .createBrowser(containerRef.current, {
        genome: "hg38",    // dbRIP uses GRCh38; user can change via dropdown
        locus: locusInput, // initial view position
        tracks: [],        // start empty; user adds tracks below
      })
      .then((browser) => {
        if (cancelled) {
          // Component unmounted while we were initializing — discard the browser.
          igv.removeBrowser(browser);
          return;
        }
        browserRef.current = browser;
      });

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // Runs when the component unmounts OR before the effect runs again (which
    // won't happen with `[]` deps, but the pattern is correct).
    // igv.removeBrowser() detaches all igv DOM nodes and event listeners.
    return () => {
      cancelled = true;
      if (browserRef.current) {
        igv.removeBrowser(browserRef.current);
        browserRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — browser is created once; genome changes call reinitialize()

  // ── External locus navigation ──────────────────────────────────────────────
  //
  // When App.tsx changes the `locus` prop (user clicked "View in IGV" in
  // InteractiveSearch), navigate the browser to that locus.
  //
  // This is a separate useEffect from the init effect. It runs every time
  // the `locus` prop value changes.
  useEffect(() => {
    if (!locus) return;
    if (browserRef.current) {
      browserRef.current.search(locus);
      setLocusInput(locus); // keep the text field in sync
    }
    // If browserRef.current is null here, the browser is still initializing.
    // The navigation is silently skipped — the user can click "View in IGV" again.
  }, [locus]);

  // ── Genome reinitialize ────────────────────────────────────────────────────
  //
  // igv.js does not support changing the genome of an existing browser.
  // We must destroy the current browser and create a fresh one with the new genome.
  // This wipes all loaded tracks (they were part of the old browser instance).
  async function reinitialize(newGenome: Genome) {
    if (!containerRef.current) return;

    // Destroy the existing browser and release its DOM nodes + listeners.
    if (browserRef.current) {
      igv.removeBrowser(browserRef.current);
      browserRef.current = null;
    }

    // Clear the track list — tracks don't survive a genome change.
    setTracks([]);
    setLoadError(null);

    const browser = await igv.createBrowser(containerRef.current, {
      genome: newGenome,
      locus: locusInput,
      tracks: [],
    });
    browserRef.current = browser;
  }

  function handleGenomeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newGenome = e.target.value as Genome;
    setGenome(newGenome);
    reinitialize(newGenome);
  }

  // ── Navigate to locus (Go button / Enter key) ──────────────────────────────
  function handleGoToLocus() {
    if (browserRef.current && locusInput.trim()) {
      browserRef.current.search(locusInput.trim());
    }
  }

  // ── Track type change ──────────────────────────────────────────────────────
  // Reset the file pickers and error when the user switches track format.
  function handleTrackTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setTrackType(e.target.value as TrackType);
    setMainFile(null);
    setIndexFile(null);
    setTrackName("");
    setLoadError(null);
  }

  // ── Add track ─────────────────────────────────────────────────────────────
  //
  // igv.js accepts a JS File object directly as the `url` in a track config.
  // The browser reads it locally via the Blob API — no server upload required.
  // This is what allows bioinformaticians to load their own data without
  // transferring potentially large BAM files over a network.
  async function handleAddTrack() {
    if (!browserRef.current || !mainFile) return;

    setIsAddingTrack(true);
    setLoadError(null);

    // Use the user-typed name, or default to the file's original filename.
    const name = trackName.trim() || mainFile.name;

    let config: igv.TrackConfig;

    if (trackType === "bam") {
      if (!indexFile) {
        // BAM files are compressed binary; igv needs the .bai index to jump
        // directly to the bytes covering the visible region. Without it, igv
        // would have to read the entire (potentially multi-GB) file.
        setLoadError("BAM files require a .bai index file. Please select both files.");
        setIsAddingTrack(false);
        return;
      }
      config = {
        type: "alignment",
        format: "bam",
        name,
        url: mainFile,       // igv reads random byte ranges from this File object
        indexURL: indexFile, // .bai index tells igv which bytes to read
      };
    } else if (trackType === "bed") {
      config = {
        type: "annotation",
        format: "bed",
        name,
        url: mainFile,
        indexed: false, // load the entire file into memory; fine for small BED files
      };
    } else {
      // vcf
      config = {
        type: "variant",
        format: "vcf",
        name,
        url: mainFile,
        indexed: false, // same reasoning as BED above
      };
    }

    try {
      await browserRef.current.loadTrack(config);
      // Track loaded — add it to the list so we can show a Remove button.
      setTracks((prev) => [...prev, { name }]);
      // Reset the upload form for the next track.
      setTrackName("");
      setMainFile(null);
      setIndexFile(null);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "Failed to load track. Check that the file is a valid format."
      );
    } finally {
      setIsAddingTrack(false);
    }
  }

  // ── Remove track ───────────────────────────────────────────────────────────
  function handleRemoveTrack(name: string) {
    if (!browserRef.current) return;
    browserRef.current.removeTrackByName(name);
    setTracks((prev) => prev.filter((t) => t.name !== name));
  }

  // The Add Track button is only enabled when the minimum required files exist.
  // BAM needs both main file + index; BED and VCF only need the main file.
  const canAddTrack =
    !isAddingTrack && mainFile !== null && (trackType !== "bam" || indexFile !== null);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Genome + locus controls ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 items-end">

        {/* Reference genome selector.
            igv.js fetches the genome sequence and gene annotations from igv.org
            servers when using these built-in genome IDs. The dbRIP database is
            aligned to GRCh38 / hg38, so that is the default.

            Changing the genome destroys the current browser and creates a new one,
            which clears all loaded tracks. This is a igv.js limitation — it does
            not support swapping genomes on a live browser instance. */}
        <div>
          <p className="text-xs font-semibold mb-1">Reference genome</p>
          <select
            value={genome}
            onChange={handleGenomeChange}
            className="border border-black px-2 py-1 text-sm"
          >
            <option value="hg38">GRCh38 / hg38 (recommended for dbRIP)</option>
            <option value="hg19">GRCh37 / hg19 (older datasets)</option>
          </select>
          <p className="text-xs mt-0.5 italic">Changing genome clears all loaded tracks.</p>
        </div>

        {/* Locus search bar.
            Accepts coordinate format ("chr1:1,000,000-1,001,000") or gene names
            ("BRCA1"). Gene names are resolved via igv.js's built-in NCBI search.
            This field is also updated automatically when the `locus` prop changes
            (i.e. when the user clicks "View in IGV" in InteractiveSearch). */}
        <div className="flex-1 min-w-[280px]">
          <p className="text-xs font-semibold mb-1">Go to locus</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={locusInput}
              onChange={(e) => setLocusInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGoToLocus()}
              placeholder="e.g. chr1:1,000,000-1,001,000 or BRCA1"
              className="flex-1 border border-black px-2 py-1 text-sm font-mono"
            />
            <button
              onClick={handleGoToLocus}
              className="border border-black px-3 py-1 text-sm cursor-pointer hover:bg-gray-100"
            >
              Go
            </button>
          </div>
        </div>
      </div>

      {/* ── Add track section ──────────────────────────────────────────────── */}
      {/*
        Bioinformaticians can load their own data files as additional tracks.

        igv.js accepts JS File objects directly as the track URL — no server
        upload needed. The file is read locally in the browser via the Blob API.
        For BAM files, igv performs random-access byte-range reads using the .bai
        index; only the bytes for the visible region are read (efficient for
        large files). BED and VCF files are loaded entirely into memory.

        Supported formats:
          BAM  — aligned reads (e.g. output of BWA or STAR, sorted + indexed)
          BED  — feature annotations (e.g. repeat regions, peaks, custom intervals)
          VCF  — variant calls (e.g. GATK HaplotypeCaller output)
      */}
      <div className="border border-black p-3 space-y-3">
        <p className="text-sm font-semibold">Add track from local file</p>

        <div className="flex flex-wrap gap-4 items-start">
          {/* Track type dropdown — determines the rendering mode igv uses and
              which file pickers to display (BAM needs two: main file + index;
              BED and VCF need only one). */}
          <div>
            <p className="text-xs font-semibold mb-1">Track type</p>
            <select
              value={trackType}
              onChange={handleTrackTypeChange}
              className="border border-black px-2 py-1 text-sm"
            >
              <option value="bam">BAM (aligned reads)</option>
              <option value="bed">BED (annotations / intervals)</option>
              <option value="vcf">VCF (variants)</option>
            </select>
          </div>

          {/* Optional display name shown in igv's track label strip. */}
          <div>
            <p className="text-xs font-semibold mb-1">Track name (optional)</p>
            <input
              type="text"
              value={trackName}
              onChange={(e) => setTrackName(e.target.value)}
              placeholder="defaults to filename"
              className="border border-black px-2 py-1 text-sm w-44"
            />
          </div>
        </div>

        {/* File pickers — conditional on track type.
            BAM: two pickers because igv cannot do random-access reads without
                 the .bai index. The index file is typically named <file>.bam.bai
                 and is generated by `samtools index <file>.bam`.
            BED/VCF: one picker; the full file is loaded into memory (indexed: false). */}
        <div className="flex flex-wrap gap-4 items-start">
          {trackType === "bam" ? (
            <>
              <div>
                <p className="text-xs font-semibold mb-1">Alignment file (.bam)</p>
                <input
                  type="file"
                  accept=".bam"
                  onChange={(e) => setMainFile(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs font-semibold mb-1">Index file (.bai) — required</p>
                <input
                  type="file"
                  accept=".bai"
                  onChange={(e) => setIndexFile(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs font-semibold mb-1">
                {trackType === "bed"
                  ? "Annotation file (.bed)"
                  : "Variant file (.vcf, .vcf.gz)"}
              </p>
              <input
                type="file"
                accept={trackType === "bed" ? ".bed" : ".vcf,.vcf.gz"}
                onChange={(e) => setMainFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>
          )}
        </div>

        {/* Add button + error display. */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleAddTrack}
            disabled={!canAddTrack}
            className="border border-black px-3 py-1 text-sm cursor-pointer hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isAddingTrack ? "Loading…" : "Add Track"}
          </button>
          {loadError && (
            <p className="text-sm italic">{loadError}</p>
          )}
        </div>
      </div>

      {/* ── Loaded tracks list ─────────────────────────────────────────────── */}
      {/* One entry per successfully loaded track. Remove calls
          browser.removeTrackByName() which detaches the track from igv
          and removes it from this list. */}
      {tracks.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-1">Loaded tracks</p>
          <ul className="space-y-1">
            {tracks.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-sm">
                <span className="font-mono">{t.name}</span>
                <button
                  onClick={() => handleRemoveTrack(t.name)}
                  className="text-xs border border-black px-2 py-0.5 cursor-pointer hover:bg-gray-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── IGV browser container ──────────────────────────────────────────── */}
      {/*
        IMPORTANT — THIS DIV MUST HAVE A NON-ZERO HEIGHT:
          igv.js reads this element's pixel dimensions when initializing to
          size its internal canvas. If height is 0 (or "auto" with no content),
          the browser renders but is invisible — a very confusing failure mode.
          We set a fixed 600px height via inline style.

        WHY A REF AND NOT A STATE-MANAGED ELEMENT:
          igv appends its own child elements (canvas, toolbar divs, track divs)
          directly into this container. React does not know about these children
          and should not touch them. Using a ref ensures React keeps its hands off
          the container's children after the initial mount.

        NOTE ON igv.js CSS:
          igv.createBrowser() injects a <style> tag into <head> when it first runs.
          This is expected behavior — igv's styles are scoped to its own elements
          and should not affect the rest of the page.
      */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "600px" }}
      />
    </div>
  );
}
