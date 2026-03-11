/**
 * API client — typed fetch wrappers for the FastAPI backend.
 *
 * WHY A SEPARATE API CLIENT?
 *   Instead of calling fetch() directly in every component, we centralize
 *   all API calls here. This gives us:
 *     1. One place to change if the API URL or format changes
 *     2. TypeScript return types — components get autocomplete on response fields
 *     3. Consistent error handling
 *
 * HOW IT CONNECTS TO THE BACKEND:
 *   In development, Vite's proxy (configured in vite.config.ts) forwards
 *   requests from /v1/* to http://localhost:8000/v1/*. In production,
 *   both frontend and API are served from the same origin, so no proxy needed.
 *
 * HOW COMPONENTS USE THIS:
 *   Components don't call these functions directly. Instead, they use
 *   TanStack Query hooks (in src/hooks/) that wrap these functions with
 *   caching, loading states, and error handling.
 */

import type { PaginatedResponse, InsertionDetail, StatsResponse, Dataset } from "../types/insertion";

// ── Base URL ────────────────────────────────────────────────────────────
// Empty string = relative URL, which works with both the Vite proxy (dev)
// and same-origin serving (production).
const BASE = "/v1";

// ── Helper ──────────────────────────────────────────────────────────────

/**
 * Build a query string from an object, skipping null/undefined values.
 * Example: buildQuery({ me_type: "ALU", limit: 50 }) → "?me_type=ALU&limit=50"
 */
function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

/**
 * Generic fetch wrapper with error handling.
 * Throws an Error with the HTTP status if the response is not OK.
 */
async function apiFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// ── Insertions ──────────────────────────────────────────────────────────

/** Parameters for the list/search insertions endpoint. */
export interface ListInsertionsParams {
  me_type?: string | null;
  me_subtype?: string | null;
  me_category?: string | null;
  variant_class?: string | null;
  annotation?: string | null;
  dataset_id?: string | null;
  population?: string | null;
  min_freq?: number | null;
  max_freq?: number | null;
  limit?: number;
  offset?: number;
}

/**
 * Fetch a paginated list of insertions with optional filters.
 * Maps to: GET /v1/insertions?me_type=ALU&limit=50&offset=0
 */
export async function listInsertions(params: ListInsertionsParams = {}): Promise<PaginatedResponse> {
  const query = buildQuery(params as Record<string, string | number | null | undefined>);
  return apiFetch<PaginatedResponse>(`${BASE}/insertions${query}`);
}

/**
 * Fetch a single insertion by ID with population frequencies.
 * Maps to: GET /v1/insertions/A0000001
 */
export async function getInsertion(id: string): Promise<InsertionDetail> {
  return apiFetch<InsertionDetail>(`${BASE}/insertions/${id}`);
}

/**
 * Fetch insertions in a genomic region.
 * Maps to: GET /v1/insertions/region/hg38/chr1:1000000-5000000
 */
export async function getInsertionsByRegion(
  assembly: string,
  region: string,
  params: ListInsertionsParams = {}
): Promise<PaginatedResponse> {
  const query = buildQuery(params as Record<string, string | number | null | undefined>);
  return apiFetch<PaginatedResponse>(`${BASE}/insertions/region/${assembly}/${region}${query}`);
}

// ── Stats ───────────────────────────────────────────────────────────────

/**
 * Fetch summary statistics grouped by a field.
 * Maps to: GET /v1/stats?by=me_type
 */
export async function getStats(by: string = "me_type"): Promise<StatsResponse> {
  return apiFetch<StatsResponse>(`${BASE}/stats?by=${by}`);
}

// ── Datasets ────────────────────────────────────────────────────────────

/**
 * Fetch list of loaded datasets.
 * Maps to: GET /v1/datasets
 */
export async function listDatasets(): Promise<Dataset[]> {
  return apiFetch<Dataset[]>(`${BASE}/datasets`);
}

// ── Export ───────────────────────────────────────────────────────────────

/**
 * Build a URL for downloading exported data. This doesn't fetch — it returns
 * a URL string that can be used as an <a href="..."> for direct download.
 * Maps to: GET /v1/export?format=csv&me_type=ALU
 */
export function buildExportUrl(
  format: "csv" | "bed" | "vcf",
  params: ListInsertionsParams = {}
): string {
  const allParams = { ...params, format } as Record<string, string | number | null | undefined>;
  return `${BASE}/export${buildQuery(allParams)}`;
}
