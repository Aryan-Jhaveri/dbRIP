/**
 * datasets.ts — MCP tool that wraps the FastAPI datasets endpoint.
 *
 * MAPS TO: GET /v1/datasets
 *   (see app/routers/datasets.py)
 *
 * WHY THIS TOOL?
 *   The datasets endpoint is the health check for the data layer — it tells you
 *   which CSV files have been loaded and how many rows each contains. In Claude,
 *   this is useful as a first step to confirm the database is populated before
 *   running other queries. It also returns the assembly and load timestamp, which
 *   helps disambiguate if multiple versions of the data are ever loaded.
 *
 *   Suggested first call: list_datasets → confirm dbrip_v1 is present with
 *   row_count 44984. Then proceed with search tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiFetch } from "./insertions.ts";

// Local type for the dataset registry entry.
// Mirrors frontend/src/types/insertion.ts → Dataset and app/schemas.py → DatasetOut.
interface Dataset {
  id: string;
  version: string | null;
  label: string | null;
  source_url: string | null;
  assembly: string | null;
  row_count: number | null;
  loaded_at: string | null;
}

/**
 * Register the "list_datasets" tool on the given McpServer.
 *
 * No inputs — this tool always returns all loaded datasets.
 * The empty schema {} is valid: the MCP SDK accepts an empty ZodRawShape
 * and produces a tool that takes no arguments.
 */
export function registerListDatasets(server: McpServer, baseUrl: string): void {
  server.tool(
    "list_datasets",

    "List all datasets loaded in the dbRIP database. Returns ID, label, genome assembly, " +
    "row count, and load timestamp for each dataset. Start here to confirm the database " +
    "is populated (expect dbrip_v1 with row_count 44984).",

    // No inputs — empty schema
    {},

    async () => {
      try {
        const data = await apiFetch<Dataset[]>(baseUrl, "/datasets");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );
}
