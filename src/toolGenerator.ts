/**
 * Parse OpenAPI spec and register MCP tools.
 *
 * Env vars:
 *   DOKPLOY_TOOLS — comma-separated tool name patterns to expose,
 *     supports "*" wildcard (e.g. "project_*,application_*,docker_getContainers").
 *     Unset = expose everything.
 *   DOKPLOY_READONLY — "1"/"true" exposes only read-only (GET) tools.
 *   DOKPLOY_MAX_RESPONSE_CHARS — truncate tool responses above this size (default 50000).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from "./apiClient.js";
import {
  openApiSchemaToZod,
  pathToToolName,
  formatError,
  type OpenApiSchema,
  type OpenApiComponents,
} from "./utils.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: OpenApiSchema;
      };
    };
    required?: boolean;
  };
  responses?: Record<string, unknown>;
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
  components?: OpenApiComponents;
  openapi?: string;
  info?: { title?: string; version?: string };
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

// "create" is intentionally absent — additive operations aren't destructive
const DESTRUCTIVE_KEYWORDS = [
  "deploy", "start", "stop", "delete", "remove", "update",
  "restart", "rebuild", "redeploy", "clean", "reset", "drop", "kill",
];

const READ_ONLY_METHODS = new Set(["get", "head", "options"]);

const MAX_RESPONSE_CHARS = (() => {
  const n = Number(process.env.DOKPLOY_MAX_RESPONSE_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 50_000;
})();

const MAX_ERROR_CHARS = 4_000;

function parseToolFilter(): ((name: string) => boolean) | null {
  const raw = process.env.DOKPLOY_TOOLS;
  if (!raw?.trim()) return null;
  const regexes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(
      (pattern) =>
        new RegExp(
          "^" +
            pattern
              .split("*")
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join(".*") +
            "$"
        )
    );
  return (name) => regexes.some((r) => r.test(name));
}

function serializeResponse(data: unknown): string {
  const text = JSON.stringify(data);
  if (text === undefined) return String(data);
  if (text.length <= MAX_RESPONSE_CHARS) return text;

  if (Array.isArray(data)) {
    let kept = data.length;
    let sliced = text;
    while (kept > 1 && sliced.length > MAX_RESPONSE_CHARS) {
      kept = Math.ceil(kept / 2);
      sliced = JSON.stringify(data.slice(0, kept));
    }
    return JSON.stringify({
      _truncated: `showing first ${kept} of ${data.length} items; refine the query or raise DOKPLOY_MAX_RESPONSE_CHARS`,
      items: data.slice(0, kept),
    });
  }

  return (
    text.slice(0, MAX_RESPONSE_CHARS) +
    ` [truncated ${text.length - MAX_RESPONSE_CHARS} of ${text.length} chars; raise DOKPLOY_MAX_RESPONSE_CHARS to see more]`
  );
}

/**
 * Register MCP tools from an OpenAPI spec.
 */
export function registerToolsFromOpenApi(
  server: McpServer,
  spec: OpenApiSpec,
  apiClient: ApiClient
): number {
  if (!spec.paths) {
    console.error("[toolGenerator] OpenAPI spec has no paths");
    return 0;
  }

  const toolFilter = parseToolFilter();
  const readOnlyMode = ["1", "true", "yes"].includes(
    (process.env.DOKPLOY_READONLY || "").toLowerCase()
  );

  let count = 0;
  let skipped = 0;

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods = Object.keys(pathItem).filter((m) => HTTP_METHODS.includes(m));

    for (const method of methods) {
      const op = pathItem[method as keyof OpenApiPathItem] as OpenApiOperation;

      // Suffix with method only when a path has several methods, so the
      // common single-method case keeps stable names like project_all
      const baseName = pathToToolName(path);
      const toolName = methods.length > 1 ? `${baseName}_${method}` : baseName;
      const httpMethod = method.toUpperCase();

      const isReadOnly = READ_ONLY_METHODS.has(method);

      if (readOnlyMode && !isReadOnly) {
        skipped++;
        continue;
      }
      if (toolFilter && !toolFilter(toolName)) {
        skipped++;
        continue;
      }

      const description = buildDescription(toolName, op, httpMethod, path);
      const inputSchema = buildInputSchema(op, spec.components);

      const isDestructive =
        !isReadOnly &&
        DESTRUCTIVE_KEYWORDS.some((kw) => toolName.toLowerCase().includes(kw));

      const annotations: ToolAnnotations = {};
      if (isReadOnly) annotations.readOnlyHint = true;
      if (isDestructive) annotations.destructiveHint = true;

      // {param} placeholders must be substituted into the URL, not sent as data
      const pathParamNames = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const queryParamNames = new Set(
        (op.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name)
      );

      try {
        server.registerTool(
          toolName,
          { description, inputSchema, annotations },
          async (params) => {
            try {
              const input = { ...(params as Record<string, unknown>) };

              let resolvedPath = path;
              for (const name of pathParamNames) {
                resolvedPath = resolvedPath.replace(
                  `{${name}}`,
                  encodeURIComponent(String(input[name] ?? ""))
                );
                delete input[name];
              }

              // For non-GET requests, in:"query" parameters go to the URL, the rest to the body
              let query: Record<string, unknown> | undefined;
              if (httpMethod !== "GET" && queryParamNames.size > 0) {
                query = {};
                for (const name of queryParamNames) {
                  if (name in input) {
                    query[name] = input[name];
                    delete input[name];
                  }
                }
              }

              const response = await apiClient.request(
                httpMethod,
                resolvedPath.startsWith("/api/") ? resolvedPath : `/api${resolvedPath}`,
                input,
                query
              );

              if (!response.ok) {
                const errText = serializeResponse(response.data);
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: `Error ${response.status}: ${
                        errText.length > MAX_ERROR_CHARS
                          ? errText.slice(0, MAX_ERROR_CHARS) + " [truncated]"
                          : errText
                      }`,
                    },
                  ],
                  isError: true,
                };
              }

              return {
                content: [
                  {
                    type: "text" as const,
                    text: serializeResponse(response.data),
                  },
                ],
              };
            } catch (err) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Request failed: ${formatError(err)}`,
                  },
                ],
                isError: true,
              };
            }
          }
        );

        count++;
      } catch (err) {
        console.error(`[toolGenerator] Failed to register tool "${toolName}": ${formatError(err)}`);
      }
    }
  }

  if (skipped > 0) {
    console.error(
      `[toolGenerator] ${skipped} tools hidden by DOKPLOY_TOOLS/DOKPLOY_READONLY filters`
    );
  }

  return count;
}

function buildDescription(
  toolName: string,
  op: OpenApiOperation,
  method: string,
  path: string
): string {
  const overlay = TOOL_DESCRIPTIONS[toolName];
  if (overlay) {
    return `${overlay} (${method} ${path})`;
  }

  const parts: string[] = [];

  if (op.summary) {
    parts.push(op.summary);
  } else if (op.description) {
    parts.push(op.description.slice(0, 200));
  } else {
    parts.push(`${method} ${path}`);
  }

  if (op.tags?.length) {
    parts.push(`[${op.tags.join(", ")}]`);
  }

  return parts.join(" — ");
}

function buildInputSchema(
  op: OpenApiOperation,
  components?: OpenApiComponents
): Record<string, ReturnType<typeof openApiSchemaToZod>> {
  const shape: Record<string, ReturnType<typeof openApiSchemaToZod>> = {};

  // Query/path parameters
  if (op.parameters) {
    for (const param of op.parameters) {
      if (param.in === "query" || param.in === "path") {
        let paramSchema = param.schema
          ? openApiSchemaToZod(param.schema, components)
          : openApiSchemaToZod({ type: "string" }, components);

        if (param.description) {
          paramSchema = paramSchema.describe(param.description);
        }

        if (!param.required) {
          paramSchema = paramSchema.optional();
        }

        shape[param.name] = paramSchema;
      }
    }
  }

  // Request body
  let bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema?.$ref && components?.schemas) {
    const refName = /^#\/components\/schemas\/(.+)$/.exec(bodySchema.$ref)?.[1];
    bodySchema = refName ? components.schemas[refName] : undefined;
  }
  if (bodySchema?.type === "object" && bodySchema.properties) {
    const req = new Set(bodySchema.required || []);
    for (const [key, prop] of Object.entries(bodySchema.properties)) {
      let fieldSchema = openApiSchemaToZod(prop, components);
      if (prop.description) {
        fieldSchema = fieldSchema.describe(prop.description);
      }
      if (!req.has(key)) {
        fieldSchema = fieldSchema.optional();
      }
      shape[key] = fieldSchema;
    }
  }

  return shape;
}
