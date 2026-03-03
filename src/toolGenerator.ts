/**
 * Parse OpenAPI spec and register MCP tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "./apiClient.js";
import { openApiSchemaToZod, pathToToolName, formatError, type OpenApiSchema } from "./utils.js";

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
  openapi?: string;
  info?: { title?: string; version?: string };
}

const DESTRUCTIVE_KEYWORDS = [
  "deploy", "start", "stop", "delete", "remove", "create", "update",
  "restart", "rebuild", "redeploy", "clean", "reset", "drop", "kill",
];

const READ_ONLY_METHODS = new Set(["get", "head", "options"]);

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

  let count = 0;

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      const op = operation as OpenApiOperation;

      const toolName = pathToToolName(path);
      const httpMethod = method.toUpperCase();

      // Build tool description
      const description = buildDescription(op, httpMethod, path);

      // Build input schema from parameters and request body
      const inputSchema = buildInputSchema(op);

      // Safety annotations
      const isReadOnly = READ_ONLY_METHODS.has(method);
      const isDestructive = DESTRUCTIVE_KEYWORDS.some(
        (kw) => toolName.toLowerCase().includes(kw)
      );

      const annotations: Record<string, boolean> = {};
      if (isReadOnly) annotations.readOnlyHint = true;
      if (isDestructive) annotations.destructiveHint = true;

      try {
        server.tool(
          toolName,
          description,
          inputSchema,
          async (params) => {
            try {
              const response = await apiClient.request(
                httpMethod,
                path.startsWith("/api/") ? path : `/api${path}`,
                params as Record<string, unknown>
              );

              if (!response.ok) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: `Error ${response.status}: ${JSON.stringify(response.data, null, 2)}`,
                    },
                  ],
                  isError: true,
                };
              }

              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(response.data, null, 2),
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

  return count;
}

function buildDescription(op: OpenApiOperation, method: string, path: string): string {
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

function buildInputSchema(op: OpenApiOperation): Record<string, ReturnType<typeof openApiSchemaToZod>> {
  const shape: Record<string, ReturnType<typeof openApiSchemaToZod>> = {};

  // Query/path parameters
  if (op.parameters) {
    for (const param of op.parameters) {
      if (param.in === "query" || param.in === "path") {
        let paramSchema = param.schema
          ? openApiSchemaToZod(param.schema)
          : openApiSchemaToZod({ type: "string" });

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
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema?.type === "object" && bodySchema.properties) {
    const req = new Set(bodySchema.required || []);
    for (const [key, prop] of Object.entries(bodySchema.properties)) {
      let fieldSchema = openApiSchemaToZod(prop);
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
