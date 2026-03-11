/**
 * Tests for the filterRowsByRegex utility function.
 *
 * WHAT THESE TESTS VERIFY:
 *   - Empty/whitespace patterns return all rows (no filtering)
 *   - Basic string matching works (case-insensitive)
 *   - Regex patterns work (alternation, character classes)
 *   - Numeric fields are searchable as text (e.g. searching "758" matches start=758508)
 *   - Null fields are searchable (searching "null" matches rows with null values)
 *   - Invalid regex patterns return all rows instead of crashing
 *   - No rows match when pattern doesn't exist in any column
 *
 * WHY TEST THIS SEPARATELY FROM THE PAGE?
 *   filterRowsByRegex is pure logic — no React, no DOM, no hooks. Testing it
 *   in isolation is faster (no component rendering) and more precise (we can
 *   test edge cases without worrying about debounce timers or mock hooks).
 *   The InteractiveSearch page tests verify the integration (search bar →
 *   debounce → filter → table), while these tests verify the filter itself.
 *
 * TEST DATA:
 *   We use 3 rows that differ in key fields (annotation, me_subtype, strand)
 *   so we can verify that the regex matches the right rows for each pattern.
 */

import { describe, it, expect } from "vitest";
import { filterRowsByRegex } from "./filterRowsByRegex";
import type { InsertionSummary } from "../types/insertion";

// ── Test data ───────────────────────────────────────────────────────────
// Three rows with distinct values in annotation, me_subtype, and strand
// so we can test that different search patterns match different subsets.

const testRows: InsertionSummary[] = [
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
  {
    id: "L0000001",
    dataset_id: "dbrip_v1",
    assembly: "hg38",
    chrom: "chr7",
    start: 100200,
    end: 100500,
    strand: null,
    me_category: "Reference",
    me_type: "LINE1",
    rip_type: "NonLTR_LINE",
    me_subtype: "L1Ta",
    me_length: 6019,
    tsd: null,
    annotation: "INTERGENIC",
    variant_class: "Common",
  },
];

describe("filterRowsByRegex", () => {
  // ── Empty / no-op cases ─────────────────────────────────────────────

  it("returns all rows when pattern is empty", () => {
    expect(filterRowsByRegex(testRows, "")).toEqual(testRows);
  });

  it("returns all rows when pattern is only whitespace", () => {
    expect(filterRowsByRegex(testRows, "   ")).toEqual(testRows);
  });

  it("returns all rows when given an empty array", () => {
    expect(filterRowsByRegex([], "ALU")).toEqual([]);
  });

  // ── Basic string matching ───────────────────────────────────────────

  it("filters by annotation (case-insensitive)", () => {
    // "intronic" (lowercase) should match "INTRONIC" in row 2
    const result = filterRowsByRegex(testRows, "intronic");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A0000002");
  });

  it("filters by me_type — matches all ALU rows", () => {
    const result = filterRowsByRegex(testRows, "ALU");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["A0000001", "A0000002"]);
  });

  it("filters by chromosome", () => {
    const result = filterRowsByRegex(testRows, "chr7");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("L0000001");
  });

  // ── Regex patterns ──────────────────────────────────────────────────

  it("supports regex alternation (ALU|LINE1)", () => {
    // Should match all 3 rows (2 ALU + 1 LINE1)
    const result = filterRowsByRegex(testRows, "ALU|LINE1");
    expect(result).toHaveLength(3);
  });

  it("supports regex alternation for annotations", () => {
    // TERMINATOR or INTERGENIC — should match rows 1 and 3
    const result = filterRowsByRegex(testRows, "TERMINATOR|INTERGENIC");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["A0000001", "L0000001"]);
  });

  it("supports regex character class", () => {
    // Match IDs starting with "A" — should match rows 1 and 2
    const result = filterRowsByRegex(testRows, "^A000000");
    expect(result).toHaveLength(2);
  });

  // ── Numeric field matching ──────────────────────────────────────────

  it("matches numeric fields as text (start position)", () => {
    // "758" should match start=758508 in row 1
    const result = filterRowsByRegex(testRows, "758");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A0000001");
  });

  it("matches me_length as text", () => {
    // "6019" should match me_length=6019 in row 3 (LINE1)
    const result = filterRowsByRegex(testRows, "6019");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("L0000001");
  });

  // ── Null value matching ─────────────────────────────────────────────

  it("matches null values when searching for 'null'", () => {
    // Row 3 has strand=null and tsd=null. "null" should match it.
    // Rows 1 and 2 don't have null in any field.
    const result = filterRowsByRegex(testRows, "^null$");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("L0000001");
  });

  // ── Invalid regex graceful handling ─────────────────────────────────

  it("returns all rows for invalid regex (unclosed bracket)", () => {
    // "[" is not a valid regex — should return all rows, not crash
    const result = filterRowsByRegex(testRows, "[");
    expect(result).toEqual(testRows);
  });

  it("returns all rows for invalid regex (unclosed group)", () => {
    const result = filterRowsByRegex(testRows, "(abc");
    expect(result).toEqual(testRows);
  });

  // ── No match ────────────────────────────────────────────────────────

  it("returns empty array when nothing matches", () => {
    const result = filterRowsByRegex(testRows, "HERVK");
    expect(result).toEqual([]);
  });
});
