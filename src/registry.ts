/**
 * Endpoint registry — the single source of truth shared by both surfaces:
 * the classic one-tool-per-endpoint generator and the gateway.
 */
import { z, ZodTypeAny } from "zod";
import { ApiClient } from "./apiClient.js";
import {
  openApiSchemaToZod,
  pathToToolName,
  type OpenApiSchema,
  type OpenApiComponents,
} from "./utils.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: { "application/json"?: { schema?: OpenApiSchema } };
    required?: boolean;
  };
  responses?: Record<string, unknown>;
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
}

export interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
  components?: OpenApiComponents;
  openapi?: string;
  info?: { title?: string; version?: string };
}

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: (string | number | boolean)[];
}

export interface Endpoint {
  name: string;
  method: string;
  path: string;
  description: string;
  /** true when the description comes from our curated overlay, not the bare path */
  curated: boolean;
  tags: string[];
  readOnly: boolean;
  destructive: boolean;
  inputSchema: Record<string, ZodTypeAny>;
  fields: FieldInfo[];
  pathParams: string[];
  queryParams: Set<string>;
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];
const READ_ONLY_METHODS = new Set(["get", "head", "options"]);

// "create" is intentionally absent — additive operations aren't destructive
const DESTRUCTIVE_KEYWORDS = [
  "deploy", "start", "stop", "delete", "remove", "update",
  "restart", "rebuild", "redeploy", "clean", "reset", "drop", "kill",
];

export const MAX_RESPONSE_CHARS = (() => {
  const n = Number(process.env.DOKPLOY_MAX_RESPONSE_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 50_000;
})();

const MAX_ERROR_CHARS = 4_000;

export function parseToolFilter(): ((name: string) => boolean) | null {
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

export function isReadOnlyMode(): boolean {
  return ["1", "true", "yes"].includes((process.env.DOKPLOY_READONLY || "").toLowerCase());
}

function describeType(schema?: OpenApiSchema): string {
  if (!schema) return "any";
  if (schema.enum?.length) return `enum(${schema.enum.join("|")})`;
  if (schema.type === "array") return `${describeType(schema.items)}[]`;
  return schema.type || "any";
}

/**
 * Build the endpoint registry from an OpenAPI spec, honouring the
 * DOKPLOY_TOOLS / DOKPLOY_READONLY filters. Both surfaces read from this,
 * so a filtered-out endpoint is unreachable through either of them.
 */
export function buildEndpointRegistry(spec: OpenApiSpec): {
  endpoints: Map<string, Endpoint>;
  skipped: number;
} {
  const endpoints = new Map<string, Endpoint>();
  let skipped = 0;

  if (!spec.paths) return { endpoints, skipped };

  const toolFilter = parseToolFilter();
  const readOnlyMode = isReadOnlyMode();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods = Object.keys(pathItem).filter((m) => HTTP_METHODS.includes(m));

    for (const method of methods) {
      const op = pathItem[method as keyof OpenApiPathItem] as OpenApiOperation;

      // Suffix with method only when a path has several methods, so the
      // common single-method case keeps stable names like project_all
      const baseName = pathToToolName(path);
      const name = methods.length > 1 ? `${baseName}_${method}` : baseName;

      const readOnly = READ_ONLY_METHODS.has(method);

      if ((readOnlyMode && !readOnly) || (toolFilter && !toolFilter(name))) {
        skipped++;
        continue;
      }

      const { inputSchema, fields } = buildInputSchema(op, spec.components);
      const overlay = TOOL_DESCRIPTIONS[name];

      endpoints.set(name, {
        name,
        method: method.toUpperCase(),
        path,
        description: overlay || op.summary || op.description?.slice(0, 200) || `${method.toUpperCase()} ${path}`,
        curated: Boolean(overlay),
        tags: op.tags ?? [],
        readOnly,
        destructive:
          !readOnly && DESTRUCTIVE_KEYWORDS.some((kw) => name.toLowerCase().includes(kw)),
        inputSchema,
        fields,
        pathParams: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
        queryParams: new Set(
          (op.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name)
        ),
      });
    }
  }

  return { endpoints, skipped };
}

function buildInputSchema(
  op: OpenApiOperation,
  components?: OpenApiComponents
): { inputSchema: Record<string, ZodTypeAny>; fields: FieldInfo[] } {
  const inputSchema: Record<string, ZodTypeAny> = {};
  const fields: FieldInfo[] = [];

  const add = (name: string, raw: OpenApiSchema | undefined, required: boolean, description?: string) => {
    let schema = raw ? openApiSchemaToZod(raw, components) : openApiSchemaToZod({ type: "string" }, components);
    if (description) schema = schema.describe(description);
    if (!required) schema = schema.optional();
    inputSchema[name] = schema;
    fields.push({
      name,
      type: describeType(raw),
      required,
      description: description || raw?.description,
      enum: raw?.enum,
    });
  };

  // Query/path parameters
  for (const param of op.parameters ?? []) {
    if (param.in === "query" || param.in === "path") {
      add(param.name, param.schema, Boolean(param.required), param.description);
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
      add(key, prop, req.has(key), prop.description);
    }
  }

  return { inputSchema, fields };
}

export function serializeResponse(data: unknown): string {
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

export interface ToolResult {
  // SDK's CallToolResult carries an open index signature — match it
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Execute one endpoint: substitute {path} params, split query vs body,
 * call the API and shape the response. Shared by tools and gateway.
 */
export async function executeEndpoint(
  endpoint: Endpoint,
  apiClient: ApiClient,
  params: Record<string, unknown>
): Promise<ToolResult> {
  const input = { ...params };

  let resolvedPath = endpoint.path;
  for (const name of endpoint.pathParams) {
    resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(String(input[name] ?? "")));
    delete input[name];
  }

  // For non-GET requests, in:"query" parameters go to the URL, the rest to the body
  let query: Record<string, unknown> | undefined;
  if (endpoint.method !== "GET" && endpoint.queryParams.size > 0) {
    query = {};
    for (const name of endpoint.queryParams) {
      if (name in input) {
        query[name] = input[name];
        delete input[name];
      }
    }
  }

  const response = await apiClient.request(
    endpoint.method,
    resolvedPath.startsWith("/api/") ? resolvedPath : `/api${resolvedPath}`,
    input,
    query
  );

  if (!response.ok) {
    const errText = serializeResponse(response.data);
    return errorResult(
      `Error ${response.status}: ${
        errText.length > MAX_ERROR_CHARS ? errText.slice(0, MAX_ERROR_CHARS) + " [truncated]" : errText
      }`
    );
  }

  return textResult(serializeResponse(response.data));
}

/** Validate caller-supplied params against the endpoint's schema. */
export function validateParams(
  endpoint: Endpoint,
  params: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = z.object(endpoint.inputSchema).safeParse(params ?? {});
  if (parsed.success) return { ok: true, value: parsed.data as Record<string, unknown> };

  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  const required = endpoint.fields.filter((f) => f.required).map((f) => f.name);
  return {
    ok: false,
    message:
      `Invalid params for "${endpoint.name}":\n${issues}\n` +
      `Required: ${required.length ? required.join(", ") : "(none)"}. ` +
      `Call dokploy_describe("${endpoint.name}") for the full schema.`,
  };
}
