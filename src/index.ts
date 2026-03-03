#!/usr/bin/env node
/**
 * Dokploy MCP Server — dynamically generates tools from OpenAPI spec.
 *
 * Env vars:
 *   DOKPLOY_URL — base URL of Dokploy instance (e.g. https://dokploy.example.com)
 *   DOKPLOY_API_KEY — API key for authentication
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./apiClient.js";
import { registerToolsFromOpenApi } from "./toolGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json dynamically
function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = getVersion();
const log = (...args: unknown[]) => console.error("[dokploy-mcp]", ...args);

async function main() {
  const baseUrl = process.env.DOKPLOY_URL;
  const apiKey = process.env.DOKPLOY_API_KEY;

  if (!baseUrl) {
    log("FATAL: DOKPLOY_URL environment variable is required");
    process.exit(1);
  }
  if (!apiKey) {
    log("FATAL: DOKPLOY_API_KEY environment variable is required");
    process.exit(1);
  }

  log(`v${VERSION} — connecting to ${baseUrl}...`);

  const apiClient = new ApiClient({ baseUrl, apiKey });

  // Fetch OpenAPI spec from Dokploy
  log("Fetching OpenAPI spec...");
  let spec: Record<string, unknown>;

  try {
    const response = await apiClient.get("/api/settings.getOpenApiDocument");
    if (!response.ok) {
      log(`Failed to fetch OpenAPI spec: ${response.status}`, response.data);
      process.exit(1);
    }
    spec = response.data as Record<string, unknown>;
  } catch (err) {
    log("Failed to fetch OpenAPI spec:", err);
    process.exit(1);
  }

  const info = spec.info as Record<string, string> | undefined;
  log(`OpenAPI spec loaded: ${info?.title || "unknown"} v${info?.version || "?"}`);

  // Create MCP server
  const server = new McpServer({
    name: "dokploy",
    version: VERSION,
  });

  // Register tools from OpenAPI spec
  const toolCount = registerToolsFromOpenApi(server, spec as any, apiClient);
  log(`Registered ${toolCount} tools from OpenAPI spec`);

  if (toolCount === 0) {
    log("WARNING: No tools registered. Check OpenAPI spec format.");
  }

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("MCP server started (stdio transport)");
}

main().catch((err) => {
  log("FATAL:", err);
  process.exit(1);
});
