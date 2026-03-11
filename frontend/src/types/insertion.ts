/**
 * TypeScript types matching the FastAPI Pydantic schemas.
 *
 * WHY DO WE NEED THESE?
 *   The FastAPI backend returns JSON. TypeScript doesn't know the shape of that
 *   JSON at compile time. These types tell TypeScript exactly what fields to
 *   expect, so we get autocomplete and type errors if we use a wrong field name.
 *
 * HOW THESE MAP TO THE BACKEND:
 *   - InsertionSummary matches app/schemas.py → InsertionSummary
 *   - PopFrequency matches app/schemas.py → PopFrequencyOut
 *   - InsertionDetail matches app/schemas.py → InsertionDetail
 *   - PaginatedResponse matches app/schemas.py → PaginatedResponse
 *
 *   If you add a field to the Pydantic schema, add it here too.
 */

/** One population's allele frequency for an insertion. */
export interface PopFrequency {
  population: string;
  af: number | null;
}

/**
 * Lightweight insertion — returned in list/search endpoints.
 * Does NOT include population frequencies (too much data for a table of 1000s of rows).
 */
export interface InsertionSummary {
  id: string;
  dataset_id: string | null;
  assembly: string;
  chrom: string;
  start: number;
  end: number;
  strand: string | null;
  me_category: string | null;
  me_type: string;
  rip_type: string | null;
  me_subtype: string | null;
  me_length: number | null;
  tsd: string | null;
  annotation: string | null;
  variant_class: string | null;
}

/**
 * Full insertion with population frequencies — returned by the detail endpoint.
 * Includes everything in InsertionSummary plus the populations array.
 */
export interface InsertionDetail extends InsertionSummary {
  populations: PopFrequency[];
}

/**
 * Paginated response wrapper — matches the FastAPI PaginatedResponse schema.
 *
 * total:   How many rows match the filters (before pagination)
 * limit:   How many rows per page (requested by the client)
 * offset:  How many rows to skip (page number × limit)
 * results: The actual insertion rows for this page
 */
export interface PaginatedResponse {
  total: number;
  limit: number;
  offset: number;
  results: InsertionSummary[];
}

/**
 * Dataset registry entry — metadata about a loaded dataset.
 */
export interface Dataset {
  id: string;
  version: string | null;
  label: string | null;
  source_url: string | null;
  assembly: string | null;
  row_count: number | null;
  loaded_at: string | null;
}

/**
 * Stats entry — one row in a stats grouped response.
 */
export interface StatEntry {
  label: string;
  count: number;
}

export interface StatsResponse {
  group_by: string;
  entries: StatEntry[];
}
