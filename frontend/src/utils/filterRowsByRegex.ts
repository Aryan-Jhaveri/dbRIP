/**
 * filterRowsByRegex — client-side regex filter for insertion rows.
 *
 * WHY THIS IS A SEPARATE FILE:
 *   React Fast Refresh (Vite's hot-reload) only works when a file exports
 *   ONLY React components. If we export a plain function alongside a component,
 *   Fast Refresh breaks and you lose hot-reload during development. So we keep
 *   this utility in its own file and import it where needed.
 *
 *   This also makes it independently testable — we can test the regex logic
 *   without rendering any React components.
 *
 * HOW IT WORKS:
 *   1. Compile the user's search string as a case-insensitive RegExp
 *   2. For each row, convert every cell value to a string
 *   3. If ANY cell in the row matches the regex, keep the row
 *   4. If the regex is invalid (user is mid-typing), return all rows unfiltered
 *
 * WHY STRINGIFY EVERY CELL?
 *   - Numeric fields like "start" (758508) need to be searchable as text
 *   - Null fields become "null" strings — this is intentional so users can
 *     search for rows with null values (matches the CSV-as-source-of-truth rule)
 *
 * USED BY:
 *   - InteractiveSearch (pages/InteractiveSearch.tsx) — filters the current page
 */

import type { InsertionSummary } from "../types/insertion";

/**
 * Filter an array of InsertionSummary rows by a regex pattern.
 *
 * @param rows    - The current page of results from the API
 * @param pattern - The user's search input (raw string, not yet a RegExp)
 * @returns       - Filtered rows (or all rows if pattern is empty/invalid)
 */
export function filterRowsByRegex(
  rows: InsertionSummary[],
  pattern: string
): InsertionSummary[] {
  // No search = no filtering, return everything
  if (!pattern.trim()) return rows;

  // Try to compile the regex. If it's invalid (e.g. unclosed "["),
  // just return all rows — don't crash or show an error. The user
  // is probably still typing their pattern.
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i"); // "i" = case-insensitive
  } catch {
    return rows;
  }

  // Test every row: stringify each cell value and check for a match.
  // Object.values() gives us an array of all field values in the row.
  // String() converts numbers, nulls, etc. to searchable text.
  return rows.filter((row) =>
    Object.values(row).some((value) => regex.test(String(value)))
  );
}
