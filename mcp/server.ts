/**
 * server.ts — Express HTTP server exposing the dbRIP MCP endpoint.
 *
 * WHAT IS THIS FILE?
 *   This is the entry point for the MCP server. It mirrors what app/main.py is
 *   for the FastAPI backend: it imports all the tool registration functions,
 *   wires them into an McpServer, and exposes a /mcp HTTP endpoint.
 *
 * WHY HTTP INSTEAD OF STDIO?
 *   The MCP stdio transport runs as a local child process — one user, one machine.
 *   HTTP transport is a deployed server: a single URL that multiple Claude instances
 *   can reach. This is required for Claude.ai's "Custom Connectors" feature, which
 *   expects a URL like https://dbrip-mcp.example.com/mcp.
 *
 * WHY STATELESS?
 *   This server is read-only — it makes GET requests to the FastAPI backend and
 *   returns JSON. There is no state to maintain between requests. Stateless design
 *   means:
 *     - No sticky sessions needed (any instance handles any request)
 *     - Scales horizontally (deploy multiple replicas behind a load balancer)
 *     - Each Claude message is completely independent
 *   sessionIdGenerator: undefined tells the transport not to generate session IDs.
 *
 * WHY A NEW McpServer PER REQUEST?
 *   Because the server is stateless, each POST /mcp creates a fresh McpServer +
 *   transport pair and disposes them after the response completes. This is correct
 *   for stateless HTTP and avoids any shared-state bugs between requests.
 *   It's inexpensive because McpServer itself is lightweight — all the real work
 *   is done by the FastAPI backend (the only database).
 *
 * WHY console.error INSTEAD OF console.log?
 *   MCP's stdio transport reserves stdout for JSON-RPC messages; diagnostics go to
 *   stderr. This server uses HTTP, not stdio, so stdout is free — but we keep
 *   console.error for diagnostic logs as a convention consistent with MCP tooling.
 *
 * TRANSPORT: StreamableHTTPServerTransport (MCP spec 2025-03-26)
 *   This supersedes the older SSE transport. Claude.ai and Claude Desktop both
 *   support this transport when configured with a URL.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Tool registration functions — each one adds one tool to the McpServer.
// Splitting tools into separate files mirrors app/routers/ in the FastAPI backend.
import {
  registerSearchByRegion,
  registerListInsertions,
  registerGetInsertion,
} from "./tools/insertions.ts";
import { registerGetStats } from "./tools/stats.ts";
import { registerListDatasets } from "./tools/datasets.ts";

// ── Configuration ─────────────────────────────────────────────────────────────

// DBRIP_API_URL: where to find the FastAPI backend.
//   Local development: http://localhost:8000/v1  (FastAPI default)
//   Production: set this env var to the deployed backend URL.
//   NOTE: The URL already includes /v1 — tool files use paths like "/insertions",
//   not "/v1/insertions".
const BASE_URL = process.env.DBRIP_API_URL ?? "http://localhost:8000/v1";

// MCP_PORT: which port to listen on.
//   3001 avoids conflicts with the FastAPI backend (8000) and Vite dev server (5173).
const PORT = Number(process.env.MCP_PORT ?? 3001);

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// express.json() parses incoming request bodies as JSON.
// The MCP Inspector and Claude send JSON-RPC payloads in the POST body.
app.use(express.json());

// ── MCP endpoint: POST /mcp ───────────────────────────────────────────────────

// All MCP JSON-RPC messages (initialize, tools/list, tools/call) arrive here as POSTs.
// The MCP spec requires all three HTTP methods (POST, GET, DELETE) at the same path.
app.post("/mcp", async (req, res) => {
  // Create a fresh server + transport for this request (stateless design — see header).
  // sessionIdGenerator: undefined = don't track sessions (correct for stateless mode).
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server    = new McpServer({ name: "dbrip", version: "0.1.0" });

  // Register all 5 tools. Each function attaches one tool to the server.
  // Adding a new tool: create tools/newtool.ts, export registerNewTool(), add it here.
  registerSearchByRegion(server, BASE_URL);
  registerListInsertions(server, BASE_URL);
  registerGetInsertion(server, BASE_URL);
  registerGetStats(server, BASE_URL);
  registerListDatasets(server, BASE_URL);

  // Connect the server to the transport (sets up the JSON-RPC message routing),
  // then hand the request/response to the transport to process and reply.
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ── MCP endpoint: GET /mcp ────────────────────────────────────────────────────

// The MCP spec requires a GET handler at /mcp for SSE streaming sessions.
// This server is stateless, so we don't implement SSE streams.
// Return 405 Method Not Allowed with a clear explanation.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    error: "This MCP server is stateless. GET /mcp (SSE streaming) is not supported.",
  });
});

// ── MCP endpoint: DELETE /mcp ─────────────────────────────────────────────────

// The MCP spec allows clients to terminate a session with DELETE /mcp.
// Since we're stateless (no sessions), there's nothing to terminate — return 200 OK.
app.delete("/mcp", (_req, res) => res.status(200).send());

// ── Health check ──────────────────────────────────────────────────────────────

// GET /health — used by deployment platforms (Render, Railway, etc.) to check
// that the server is alive. Also mirrors GET /v1/health in the FastAPI backend.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  // console.error for diagnostic output (see header note on console.error vs console.log)
  console.error(`[dbrip-mcp] HTTP server listening on port ${PORT}`);
  console.error(`[dbrip-mcp] API backend: ${BASE_URL}`);
  console.error(`[dbrip-mcp] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.error(`[dbrip-mcp] Health check: http://localhost:${PORT}/health`);
});
