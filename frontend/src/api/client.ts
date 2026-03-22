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
 *   requests from /v1/* to http://localhost:8000/v1/*. The VITE_API_URL env
 *   var is not set locally, so BASE falls back to "/v1" and the proxy handles it.
 *
 *   In production (GitHub Pages), the frontend is on a different origin than
 *   the Render API, so we set VITE_API_URL at build time in CI:
 *     VITE_API_URL=https://dbrip-api.onrender.com/v1 npm run build
 *
 * HOW COMPONENTS USE THIS:
 *   Components don't call these functions directly. Instead, they use
 *   TanStack Query hooks (in src/hooks/) that wrap these functions with
 *   caching, loading states, and error handling.
 */

import type { PaginatedResponse, InsertionDetail, StatsResponse, Dataset } from "../types/insertion";

// ── Base URL ────────────────────────────────────────────────────────────
// VITE_API_URL is injected at build time by Vite from the environment variable
// of the same name. In production CI it is set to the Render API URL:
//   VITE_API_URL=https://dbrip-api.onrender.com/v1 npm run build
//
// In local development VITE_API_URL is not set, so this falls back to "/v1"
// and Vite's dev proxy (vite.config.ts) forwards those requests to localhost:8000.
// This means local devs never need to set the env var — it just works.
//
// import.meta.env is Vite's way of exposing build-time env vars to the browser.
// (process.env does not exist in browser bundles; Vite replaces import.meta.env
// values with string literals at build time so no env vars are shipped at runtime.)
const BASE = import.meta.env.VITE_API_URL ?? "/v1";

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
  /**
   * Strand filter. Accepts a single value ("+", "-", "null") or a
   * comma-separated list for multi-select ("+,-"). The API translates
   * "null" to a SQL IS NULL check, so it correctly matches missing strands.
   */
  strand?: string | null;
  /**
   * Chromosome filter. Accepts a single value ("chr1") or a comma-separated
   * list for multi-select ("chr1,chr2,chrX"). The API uses a SQL IN clause
   * when multiple values are provided.
   */
  chrom?: string | null;
  /**
   * Free-text search across id, chrom, me_type, me_category, rip_type,
   * me_subtype, annotation, and variant_class columns (server-side LIKE,
   * case-insensitive). Replaces client-side filterRowsByRegex so pagination
   * totals are accurate across all pages, not just the current page.
   */
  search?: string | null;
  /**
   * Filter by genome assembly (e.g. "hg38", "hs1"). When the DB contains
   * data from multiple assemblies, this prevents mixed results. Optional —
   * omit to return all assemblies.
   */
  assembly?: string | null;
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

// ── File Search ──────────────────────────────────────────────────────────

/**
 * Upload a BED/CSV/TSV file and find insertions overlapping the listed regions.
 * Maps to: POST /v1/insertions/file-search
 *
 * @param file    - The file object from an <input type="file"> or drop event
 * @param window  - Extend each region by ±window bp (default 0)
 * @param limit   - Page size
 * @param offset  - Page offset
 *
 * WHY POST INSTEAD OF GET?
 *   File uploads use multipart/form-data, which browsers send as POST.
 *   The API still doesn't modify any data — POST here just means "send me
 *   a file as input", not "create something".
 */
export async function fileSearch(
  file: File,
  window: number = 0,
  limit: number = 50,
  offset: number = 0
): Promise<PaginatedResponse> {
  const form = new FormData();
  form.append("file", file);

  const query = buildQuery({ window, limit, offset });
  const response = await fetch(`${BASE}/insertions/file-search${query}`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.detail ?? `API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
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
