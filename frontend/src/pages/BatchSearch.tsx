/**
 * BatchSearch — filter insertions by category, ME family, annotation, strand, chromosome (Tab 3).
 *
 * WHAT THIS PAGE DOES:
 *   Replicates the Shiny app's "Batch Search" tab. Users select combinations
 *   of checkboxes and dropdowns to filter insertions, then download the results.
 *   This is designed for quickly obtaining a large number of entries by criteria,
 *   which is much faster than scrolling through the Interactive Search table.
 *
 * HOW IT WORKS:
 *   1. User checks boxes / selects from dropdowns
 *   2. We build query parameters from the selected values
 *   3. useInsertions fetches matching rows from the API
 *   4. A count is shown ("X entries match your filters")
 *   5. User clicks Download to get a CSV via the export endpoint
 *
 * HOW FILTERS MAP TO THE API:
 *   The FastAPI endpoint GET /v1/insertions already supports:
 *     - me_category (Reference | Non-reference)
 *     - me_type (ALU | LINE1 | SVA | HERVK | PP)
 *     - annotation (PROMOTER | INTRONIC | etc.)
 *   But it only takes ONE value per parameter. For multi-select (e.g. user
 *   checks both ALU and SVA), we'd need the API to support comma-separated
 *   values or repeated params. For now, we use the first selected value
 *   and note this as a TODO for API enhancement.
 *
 * FILTER OPTIONS:
 *   All values match exactly what the Shiny app offers. The values (not labels)
 *   are what gets sent to the API — e.g. "+" not "Positive" for strand.
 *
 * HOW THIS FILE CONNECTS TO THE REST:
 *   - useInsertions (hooks/useInsertions.ts) → fetches from FastAPI
 *   - buildExportUrl (api/client.ts) → builds the download link
 *   - ListInsertionsParams (api/client.ts) → type for query params
 */

import { useState, useMemo } from "react";
import { useInsertions } from "../hooks/useInsertions";
import { buildExportUrl, type ListInsertionsParams } from "../api/client";

// ── Filter option definitions ────────────────────────────────────────────
// Each group has a label (shown in the UI) and a list of options.
// option.value is sent to the API, option.label is shown to the user.

interface FilterOption {
  value: string;
  label: string;
}

const CATEGORIES: FilterOption[] = [
  { value: "Reference", label: "Reference" },
  { value: "Non-reference", label: "Non-reference" },
];

const ME_FAMILIES: FilterOption[] = [
  { value: "ALU", label: "Alu" },
  { value: "LINE1", label: "LINE1" },
  { value: "SVA", label: "SVA" },
  { value: "HERVK", label: "HERVK" },
  { value: "PP", label: "Processed Pseudogene" },
];

const ANNOTATIONS: FilterOption[] = [
  { value: "PROMOTER", label: "Promoter" },
  { value: "5_UTR", label: "5_UTR" },
  { value: "EXON", label: "Exon" },
  { value: "INTRONIC", label: "Intronic" },
  { value: "3_UTR", label: "3_UTR" },
  { value: "TERMINATOR", label: "Terminator" },
  { value: "INTERGENIC", label: "Intergenic" },
  { value: "null", label: "Undetermined" },
];

const STRANDS: FilterOption[] = [
  { value: "+", label: "Positive" },
  { value: "-", label: "Negative" },
  { value: "null", label: "Undetermined" },
];

const CHROMOSOMES: FilterOption[] = [
  ...Array.from({ length: 22 }, (_, i) => ({
    value: `chr${i + 1}`,
    label: `Chr${i + 1}`,
  })),
  { value: "chrX", label: "ChrX" },
  { value: "chrY", label: "ChrY" },
];

// ── Checkbox group sub-component ─────────────────────────────────────────

/**
 * CheckboxGroup — renders a labeled group of checkboxes.
 * Manages its own selected state via the parent's setter function.
 *
 * @param label     - Group heading (e.g. "By Category:")
 * @param options   - Available options with value/label pairs
 * @param selected  - Currently selected values (Set for O(1) lookup)
 * @param onChange  - Called with updated Set when a checkbox is toggled
 */
function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="text-sm font-semibold mb-1">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(opt.value)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(opt.value)) {
                  next.delete(opt.value);
                } else {
                  next.add(opt.value);
                }
                onChange(next);
              }}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export default function BatchSearch() {
  // ── Filter state ─────────────────────────────────────────────────────
  // Each filter group tracks its selected values as a Set of strings.
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [meFamilies, setMeFamilies] = useState<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<Set<string>>(new Set());
  const [strands, setStrands] = useState<Set<string>>(new Set());
  const [chromosomes, setChromosomes] = useState<Set<string>>(new Set());

  // ── Build API params from selected filters ───────────────────────────
  // The API currently takes single values, so we use the first selected.
  // TODO: Update API to support multi-value params (e.g. me_type=ALU,SVA)
  const params: ListInsertionsParams = useMemo(() => {
    const p: ListInsertionsParams = { limit: 1, offset: 0 };
    if (categories.size === 1) p.me_category = [...categories][0];
    if (meFamilies.size === 1) p.me_type = [...meFamilies][0];
    if (annotations.size === 1) p.annotation = [...annotations][0];
    return p;
  }, [categories, meFamilies, annotations]);

  // ── Check if any filter is selected ──────────────────────────────────
  const hasFilters =
    categories.size > 0 ||
    meFamilies.size > 0 ||
    annotations.size > 0 ||
    strands.size > 0 ||
    chromosomes.size > 0;

  // ── Fetch count of matching results ──────────────────────────────────
  // We only fetch with limit=1 to get the total count — we don't need
  // the actual rows (the user downloads them via the export endpoint).
  const { data, isLoading } = useInsertions(hasFilters ? params : { limit: 1, offset: 0 });

  // ── Build export URL with current filters ────────────────────────────
  const exportParams: ListInsertionsParams = {};
  if (categories.size === 1) exportParams.me_category = [...categories][0];
  if (meFamilies.size === 1) exportParams.me_type = [...meFamilies][0];
  if (annotations.size === 1) exportParams.annotation = [...annotations][0];
  const exportUrl = buildExportUrl("csv", exportParams);

  return (
    <div className="flex gap-8">
      {/* ── Left column: Category, ME Family, Annotation ───────────────── */}
      <div className="flex-1">
        <CheckboxGroup
          label="By Category:"
          options={CATEGORIES}
          selected={categories}
          onChange={setCategories}
        />
        <CheckboxGroup
          label="By ME Family:"
          options={ME_FAMILIES}
          selected={meFamilies}
          onChange={setMeFamilies}
        />
        <CheckboxGroup
          label="By Annotation:"
          options={ANNOTATIONS}
          selected={annotations}
          onChange={setAnnotations}
        />

        {/* Download + count */}
        <div className="mt-4 flex items-center gap-4">
          <a
            href={exportUrl}
            download
            className="border border-black px-3 py-1 text-sm no-underline hover:bg-gray-100 inline-block"
          >
            Download
          </a>
          <span className="text-sm">
            {isLoading
              ? "Counting..."
              : data
                ? `${data.total.toLocaleString()} entries match your filters`
                : "Select filters to search"}
          </span>
        </div>
      </div>

      {/* ── Right column: Genome, Organism, Chromosomes, Strand ─────────── */}
      <div className="flex-1">
        {/* Genome version — locked to GRCh38 for now */}
        <div className="mb-4">
          <label className="text-sm font-semibold block mb-1">By Genome Version:</label>
          <select className="border border-black px-2 py-1 text-sm" disabled>
            <option>GRCh38</option>
          </select>
        </div>

        {/* Organism — locked to Human for now */}
        <div className="mb-4">
          <label className="text-sm font-semibold block mb-1">By Organism:</label>
          <select className="border border-black px-2 py-1 text-sm" disabled>
            <option>Human</option>
          </select>
        </div>

        {/* Chromosomes — multi-select */}
        <div className="mb-4">
          <label className="text-sm font-semibold block mb-1">By Chromosomes:</label>
          <select
            multiple
            value={[...chromosomes]}
            onChange={(e) => {
              const selected = new Set(
                Array.from(e.target.selectedOptions, (opt) => opt.value)
              );
              setChromosomes(selected);
            }}
            className="border border-black px-2 py-1 text-sm w-full h-32"
          >
            {CHROMOSOMES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1">Hold Ctrl/Cmd to select multiple</p>
        </div>

        <CheckboxGroup
          label="By Strand:"
          options={STRANDS}
          selected={strands}
          onChange={setStrands}
        />
      </div>
    </div>
  );
}
