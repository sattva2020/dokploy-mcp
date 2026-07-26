#!/usr/bin/env node
/**
 * Dokploy MCP Server — dynamically generates tools from OpenAPI spec.
 *
 * Env vars:
 *   DOKPLOY_URL — base URL of Dokploy instance (e.g. https://dokploy.example.com)
 *   DOKPLOY_API_KEY — API key for authentication
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
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

  // Fetch OpenAPI spec from Dokploy; keep a disk cache so a temporarily
  // unreachable Dokploy doesn't take the whole MCP server down with it
  log("Fetching OpenAPI spec...");
  const specCachePath = join(
    tmpdir(),
    `dokploy-mcp-spec-${baseUrl.replace(/[^a-zA-Z0-9]/g, "_")}.json`
  );
  let spec: Record<string, unknown>;

  try {
    const response = await apiClient.get("/api/settings.getOpenApiDocument");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 300)}`);
    }
    spec = response.data as Record<string, unknown>;
    try {
      writeFileSync(specCachePath, JSON.stringify(spec));
    } catch {
      // cache is best-effort
    }
  } catch (err) {
    log("Failed to fetch OpenAPI spec:", err);
    try {
      spec = JSON.parse(readFileSync(specCachePath, "utf-8"));
      log(`Using cached OpenAPI spec from ${specCachePath} (may be stale)`);
    } catch {
      log("FATAL: Dokploy is unreachable and no cached spec exists");
      process.exit(1);
    }
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
