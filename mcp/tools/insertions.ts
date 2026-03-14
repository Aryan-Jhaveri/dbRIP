/**
 * insertions.ts — MCP tools that wrap the FastAPI insertions endpoints.
 *
 * WHAT IS AN MCP TOOL?
 *   An MCP tool is a function that Claude can call. Each tool has:
 *     - A name  (what Claude types to invoke it)
 *     - A description  (what Claude reads to decide when to use it)
 *     - A Zod input schema  (validates + types the arguments Claude passes)
 *     - A handler  (runs when Claude calls the tool; returns a text result)
 *
 * THIS FILE EXPORTS THREE THINGS:
 *   1. buildParams()    — shared utility, imported by stats.ts + datasets.ts
 *   2. apiFetch<T>()    — shared utility, imported by stats.ts + datasets.ts
 *   3. Three register*() functions — called by server.ts to attach tools to McpServer
 *
 * HOW THIS CONNECTS TO THE FASTAPI BACKEND:
 *   Each tool calls a different FastAPI endpoint (see app/routers/insertions.py).
 *   The BASE_URL is passed in from server.ts so it's configurable via env var.
 *
 * RELATIONSHIP TO frontend/src/api/client.ts:
 *   buildParams() here mirrors buildQuery() in client.ts — same idea, different runtime.
 *   Both skip null/undefined/"" values to avoid sending empty query params to the API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── TypeScript interfaces ────────────────────────────────────────────────────
// These mirror frontend/src/types/insertion.ts and app/schemas.py.
// They give us type safety when we JSON.parse() API responses.

/** One population's allele frequency for an insertion. */
interface PopFrequency {
  population: string;
  af: number | null;
}

/**
 * Lightweight insertion record — fields returned by list/search endpoints.
 * Matches app/schemas.py → InsertionSummary.
 */
interface InsertionSummary {
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
 * Matches app/schemas.py → InsertionDetail.
 */
interface InsertionDetail extends InsertionSummary {
  populations: PopFrequency[];
}

/**
 * Paginated response wrapper — matches app/schemas.py → PaginatedResponse.
 * total tells Claude how many rows matched (before pagination).
 */
interface PaginatedResponse {
  total: number;
  limit: number;
  offset: number;
  results: InsertionSummary[];
}

// ── Shared utilities ─────────────────────────────────────────────────────────

/**
 * Build a URLSearchParams object from a plain object, skipping null/undefined/""
 * values so we never send empty query parameters to the FastAPI backend.
 *
 * MIRRORS: buildQuery() in frontend/src/api/client.ts — same pattern, different runtime.
 *   (The frontend uses string concatenation; here we return URLSearchParams
 *    because fetch() accepts it directly as the request body or can be .toString()'d.)
 *
 * EXAMPLE:
 *   buildParams({ me_type: "ALU", min_freq: undefined, limit: 50 })
 *   → URLSearchParams { "me_type" → "ALU", "limit" → "50" }
 */
export function buildParams(
  obj: Record<string, string | number | boolean | undefined | null>
): URLSearchParams {
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  // URLSearchParams constructor accepts an array of [key, value] string pairs.
  // String(v) converts numbers and booleans to their string representations.
  return new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
}

/**
 * Typed fetch wrapper for the FastAPI backend.
 *
 * WHY EXPORT THIS?
 *   stats.ts and datasets.ts import this so they don't need their own fetch wrappers.
 *   It keeps all HTTP logic in one place.
 *
 * PARAMETERS:
 *   baseUrl — e.g. "http://localhost:8000/v1" (passed from server.ts)
 *   path    — e.g. "/insertions" or "/stats" (relative to /v1)
 *   params  — optional URLSearchParams appended as query string
 *
 * THROWS: Error with a descriptive message if the response is not 2xx.
 *   The calling tool's try/catch converts this into a Claude-readable error text.
 */
export async function apiFetch<T>(
  baseUrl: string,
  path: string,
  params?: URLSearchParams
): Promise<T> {
  // Build the full URL: base + path + optional query string
  const qs = params && params.toString() ? `?${params.toString()}` : "";
  const url = `${baseUrl}${path}${qs}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.statusText} — ${url}`);
  }
  return response.json() as Promise<T>;
}

// ── Tool: search_by_region ────────────────────────────────────────────────────

/**
 * Register the "search_by_region" tool on the given McpServer.
 *
 * MAPS TO: GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}
 *   (see app/routers/insertions.py → get_insertions_by_region)
 *
 * WHY SEPARATE FROM list_insertions?
 *   Region search is the primary bioinformatics use case — "what TEs are near
 *   my gene of interest?" Having a dedicated tool with chrom/start/end as
 *   required inputs makes this natural for Claude to discover and invoke.
 */
export function registerSearchByRegion(server: McpServer, baseUrl: string): void {
  server.tool(
    "search_by_region",

    // Description — Claude reads this to decide when to use the tool.
    // Mention the coordinate system and population code examples so Claude
    // can answer follow-up questions without extra tool calls.
    "Find TE insertions overlapping a genomic region. Coordinates are 1-based " +
    "(same as dbRIP source data). Returns total count + paginated results. " +
    "population can be individual 1000G codes (ACB, ASW, BEB, CDX, CEU, CHB, CHS, " +
    "CLM, ESN, FIN, GBR, GIH, GWD, IBS, ITU, JPT, KHV, LWK, MSL, MXL, PEL, PJL, " +
    "PUR, STU, TSI, YRI) or super-population aggregates (AFR, AMR, EAS, EUR, SAS, " +
    "Non_African, All).",

    // Input schema — the MCP SDK accepts a ZodRawShape (plain object of Zod fields),
    // NOT a wrapped z.object(). The SDK internally calls z.object(shape) for you.
    {
      chrom: z.string()
        .describe("Chromosome, e.g. chr1, chr2, chrX, chrY, chrM"),
      start: z.number().int().positive()
        .describe("Start coordinate (1-based, inclusive)"),
      end: z.number().int().positive()
        .describe("End coordinate (1-based, inclusive)"),
      assembly: z.string().default("hg38")
        .describe("Genome assembly — default hg38 (the only assembly in dbRIP v1)"),
      me_type: z.string().optional()
        .describe("TE family filter: ALU, LINE1, SVA, HERVK, PP"),
      me_category: z.string().optional()
        .describe("TE category: Non-reference (polymorphic) or Reference (fixed)"),
      population: z.string().optional()
        .describe("Population code to filter by allele frequency (requires min_freq)"),
      min_freq: z.number().min(0).max(1).optional()
        .describe("Minimum allele frequency in the specified population (0.0–1.0)"),
      annotation: z.string().optional()
        .describe("Genomic annotation: INTRONIC, INTERGENIC, EXONIC, UTR5, UTR3, etc."),
      variant_class: z.string().optional()
        .describe("Frequency class: Very Rare (<1%), Rare (1–5%), Low Frequency (5–10%), Common (>10%)"),
    },

    // Handler — called when Claude invokes the tool with validated args.
    // Errors are returned as readable text (not thrown) so Claude can reason about them.
    async (args) => {
      try {
        // Build path: /insertions/region/hg38/chr1:700000-800000
        const path = `/insertions/region/${args.assembly}/${args.chrom}:${args.start}-${args.end}`;

        // Optional filters go in the query string
        const params = buildParams({
          me_type:       args.me_type,
          me_category:   args.me_category,
          population:    args.population,
          min_freq:      args.min_freq,
          annotation:    args.annotation,
          variant_class: args.variant_class,
        });

        const data = await apiFetch<PaginatedResponse>(baseUrl, path, params);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}

// ── Tool: list_insertions ─────────────────────────────────────────────────────

/**
 * Register the "list_insertions" tool on the given McpServer.
 *
 * MAPS TO: GET /v1/insertions
 *   (see app/routers/insertions.py → list_insertions)
 *
 * USE CASE: Database-wide searches when no specific region is known.
 * For example: "How many LINE1 insertions are Common in the EUR population?"
 * or "Find intronic ALU insertions."
 *
 * All parameters are optional — calling with no arguments returns the first
 * 50 insertions (ordered by ID), which is a good way to sample the data.
 */
export function registerListInsertions(server: McpServer, baseUrl: string): void {
  server.tool(
    "list_insertions",

    "Filter and search TE insertions database-wide. 'search' does free-text match " +
    "across ID, chrom, me_type, me_category, rip_type, me_subtype, annotation, and " +
    "variant_class (server-side, case-insensitive). All other params are exact filters " +
    "that stack with AND logic. Returns total count + paginated results.",

    {
      search: z.string().optional()
        .describe("Free-text search across key columns (case-insensitive LIKE)"),
      me_type: z.string().optional()
        .describe("TE family: ALU, LINE1, SVA, HERVK, PP (comma-separated for multiple)"),
      me_category: z.string().optional()
        .describe("Non-reference or Reference (comma-separated for multiple)"),
      annotation: z.string().optional()
        .describe("Genomic annotation, e.g. INTRONIC, INTERGENIC, EXONIC"),
      variant_class: z.string().optional()
        .describe("Very Rare, Rare, Low Frequency, Common (comma-separated for multiple)"),
      population: z.string().optional()
        .describe("Population code to filter by allele frequency"),
      min_freq: z.number().min(0).max(1).optional()
        .describe("Minimum allele frequency (0.0–1.0) in the specified population"),
      max_freq: z.number().min(0).max(1).optional()
        .describe("Maximum allele frequency (0.0–1.0) in the specified population"),
      chrom: z.string().optional()
        .describe("Chromosome filter, e.g. chr1 (comma-separated for multiple: chr1,chr2,chrX)"),
      strand: z.string().optional()
        .describe("Strand filter: + or - or null (comma-separated for multiple)"),
      limit: z.number().int().min(1).max(1000).default(50)
        .describe("Rows per page (default 50, max 1000)"),
      offset: z.number().int().min(0).default(0)
        .describe("Rows to skip for pagination (default 0)"),
    },

    async (args) => {
      try {
        const params = buildParams({
          search:        args.search,
          me_type:       args.me_type,
          me_category:   args.me_category,
          annotation:    args.annotation,
          variant_class: args.variant_class,
          population:    args.population,
          min_freq:      args.min_freq,
          max_freq:      args.max_freq,
          chrom:         args.chrom,
          strand:        args.strand,
          limit:         args.limit,
          offset:        args.offset,
        });

        const data = await apiFetch<PaginatedResponse>(baseUrl, "/insertions", params);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}

// ── Tool: get_insertion ───────────────────────────────────────────────────────

/**
 * Register the "get_insertion" tool on the given McpServer.
 *
 * MAPS TO: GET /v1/insertions/{id}
 *   (see app/routers/insertions.py → get_insertion)
 *
 * USE CASE: Full detail view for a known insertion ID.
 * Returns everything in InsertionSummary PLUS allele frequencies for all 33 populations.
 * This is the richest response — useful for deep-dive analysis on a specific insertion.
 *
 * SPECIAL 404 HANDLING:
 *   We don't use apiFetch() here because 404 should return a readable "not found"
 *   message rather than throwing an error. All other non-2xx codes still throw.
 */
export function registerGetInsertion(server: McpServer, baseUrl: string): void {
  server.tool(
    "get_insertion",

    "Get the full record for a single insertion by ID, including allele frequencies " +
    "for all 33 populations (26 individual + 7 super-population aggregates). " +
    "Use list_insertions or search_by_region to discover IDs first.",

    {
      id: z.string()
        .describe("Insertion ID, e.g. A0000001. IDs start with A (dbRIP v1 dataset)."),
    },

    async (args) => {
      try {
        const url = `${baseUrl}/insertions/${args.id}`;
        const response = await fetch(url);

        // 404 is an expected, informative outcome — return as readable text.
        // Other non-2xx codes are unexpected errors that should be surfaced clearly.
        if (response.status === 404) {
          return { content: [{ type: "text", text: `Insertion ${args.id} not found` }] };
        }
        if (!response.ok) {
          throw new Error(`API error ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as InsertionDetail;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}
