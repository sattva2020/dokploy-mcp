/**
 * Classic surface: one MCP tool per Dokploy endpoint.
 *
 * Env vars:
 *   DOKPLOY_TOOLS — comma-separated tool name patterns to expose,
 *     supports "*" wildcard (e.g. "project_*,application_*,docker_getContainers").
 *     Unset = expose everything.
 *   DOKPLOY_READONLY — "1"/"true" exposes only read-only (GET) tools.
 *   DOKPLOY_MAX_RESPONSE_CHARS — truncate tool responses above this size (default 50000).
 *
 * Both filters are applied when the registry is built (see registry.ts), so
 * they constrain the gateway surface too.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from "./apiClient.js";
import { formatError } from "./utils.js";
import { type Endpoint, executeEndpoint, errorResult } from "./registry.js";

/**
 * Register one MCP tool per endpoint in the registry.
 */
export function registerEndpointTools(
  server: McpServer,
  endpoints: Map<string, Endpoint>,
  apiClient: ApiClient
): number {
  let count = 0;

  for (const endpoint of endpoints.values()) {
    const annotations: ToolAnnotations = {};
    if (endpoint.readOnly) annotations.readOnlyHint = true;
    if (endpoint.destructive) annotations.destructiveHint = true;

    const description = endpoint.curated
      ? `${endpoint.description} (${endpoint.method} ${endpoint.path})`
      : endpoint.tags.length
        ? `${endpoint.description} — [${endpoint.tags.join(", ")}]`
        : endpoint.description;

    try {
      server.registerTool(
        endpoint.name,
        { description, inputSchema: endpoint.inputSchema, annotations },
        async (params) => {
          try {
            return await executeEndpoint(endpoint, apiClient, params as Record<string, unknown>);
          } catch (err) {
            return errorResult(`Request failed: ${formatError(err)}`);
          }
        }
      );
      count++;
    } catch (err) {
      console.error(
        `[toolGenerator] Failed to register tool "${endpoint.name}": ${formatError(err)}`
      );
    }
  }

  return count;
}
