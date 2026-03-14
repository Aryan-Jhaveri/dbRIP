/**
 * stats.ts — MCP tool that wraps the FastAPI stats endpoint.
 *
 * MAPS TO: GET /v1/stats?by={field}
 *   (see app/routers/stats.py → get_stats)
 *
 * WHY ONE TOOL FOR ALL STATS?
 *   The FastAPI stats endpoint is a single parameterized GROUP BY query.
 *   Rather than making 7 separate tools (one per field), we expose the
 *   same "by" parameter that the API uses. Claude can explore all breakdowns
 *   with a single tool call.
 *
 * ENUM VALUES:
 *   The z.enum() values here MUST match ALLOWED_GROUP_BY in app/routers/stats.py exactly.
 *   If you add a new field to ALLOWED_GROUP_BY, add it to the enum below too.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch } from "./insertions.ts";

// Local type for the stats response shape.
// Mirrors frontend/src/types/insertion.ts → StatsResponse and app/schemas.py → StatsResponse.
interface StatsResponse {
  group_by: string;
  entries: { label: string; count: number }[];
}

/**
 * Register the "get_stats" tool on the given McpServer.
 *
 * EXAMPLE Claude queries that would use this tool:
 *   "How many ALU vs LINE1 vs SVA insertions are in dbRIP?"  → by: "me_type"
 *   "What chromosomes have the most insertions?"             → by: "chrom"
 *   "How many insertions are Common vs Rare?"                → by: "variant_class"
 */
export function registerGetStats(server: McpServer, baseUrl: string): void {
  server.tool(
    "get_stats",

    "Aggregate counts grouped by a field. Quick breakdown of the full database: " +
    "me_type = TE family totals (ALU, LINE1, SVA, HERVK, PP); " +
    "chrom = insertions per chromosome; " +
    "variant_class = Very Rare / Rare / Low Frequency / Common counts; " +
    "annotation = INTRONIC / INTERGENIC / EXONIC / etc.; " +
    "me_category = Non-reference vs Reference counts; " +
    "me_subtype = detailed TE subfamily breakdown; " +
    "dataset_id = rows per loaded dataset.",

    {
      // The enum values exactly mirror ALLOWED_GROUP_BY in app/routers/stats.py.
      // z.enum() both validates the input and shows Claude the allowed choices.
      by: z.enum([
        "me_type",
        "me_subtype",
        "me_category",
        "chrom",
        "variant_class",
        "annotation",
        "dataset_id",
      ]).default("me_type")
        .describe("Field to group by — see tool description for what each produces"),
    },

    async (args) => {
      try {
        // The stats endpoint takes ?by=<field> as its only query parameter.
        const params = new URLSearchParams({ by: args.by });
        const data = await apiFetch<StatsResponse>(baseUrl, "/stats", params);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}
