/**
 * Utilities: OpenAPI schema → Zod schema conversion, error formatting.
 */
import { z, ZodTypeAny } from "zod";

export interface OpenApiSchema {
  type?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  enum?: (string | number | boolean)[];
  nullable?: boolean;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  $ref?: string;
  format?: string;
}

/**
 * Convert an OpenAPI schema to a Zod schema for MCP tool input validation.
 */
export function openApiSchemaToZod(
  schema: OpenApiSchema,
  requiredFields?: string[]
): ZodTypeAny {
  if (!schema || (!schema.type && !schema.properties && !schema.enum && !schema.oneOf && !schema.anyOf && !schema.allOf)) {
    return z.any();
  }

  // Enum
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.map(String);
    let zodSchema: ZodTypeAny = z.enum(values as [string, ...string[]]);
    if (schema.nullable) zodSchema = zodSchema.nullable();
    if (schema.description) zodSchema = zodSchema.describe(schema.description);
    return zodSchema;
  }

  // oneOf / anyOf — accept any type
  if (schema.oneOf || schema.anyOf) {
    return z.any();
  }

  // allOf — merge properties
  if (schema.allOf) {
    const merged: OpenApiSchema = { type: "object", properties: {}, required: [] };
    for (const sub of schema.allOf) {
      if (sub.properties) {
        merged.properties = { ...merged.properties, ...sub.properties };
      }
      if (sub.required) {
        merged.required = [...(merged.required || []), ...sub.required];
      }
    }
    return openApiSchemaToZod(merged);
  }

  switch (schema.type) {
    case "string": {
      let s = z.string();
      if (schema.minLength !== undefined) s = s.min(schema.minLength);
      if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
      let result: ZodTypeAny = s;
      if (schema.nullable) result = result.nullable();
      if (schema.description) result = result.describe(schema.description);
      return result;
    }

    case "number":
    case "integer": {
      let n = z.number();
      if (schema.minimum !== undefined) n = n.min(schema.minimum);
      if (schema.maximum !== undefined) n = n.max(schema.maximum);
      let result: ZodTypeAny = n;
      if (schema.nullable) result = result.nullable();
      if (schema.description) result = result.describe(schema.description);
      return result;
    }

    case "boolean": {
      let result: ZodTypeAny = z.boolean();
      if (schema.nullable) result = result.nullable();
      if (schema.description) result = result.describe(schema.description);
      return result;
    }

    case "array": {
      const itemSchema = schema.items
        ? openApiSchemaToZod(schema.items)
        : z.any();
      let result: ZodTypeAny = z.array(itemSchema);
      if (schema.nullable) result = result.nullable();
      if (schema.description) result = result.describe(schema.description);
      return result;
    }

    case "object": {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        let result: ZodTypeAny = z.record(z.any());
        if (schema.description) result = result.describe(schema.description);
        return result;
      }

      const shape: Record<string, ZodTypeAny> = {};
      const req = new Set(schema.required || requiredFields || []);

      for (const [key, prop] of Object.entries(schema.properties)) {
        let fieldSchema = openApiSchemaToZod(prop);
        if (!req.has(key)) {
          fieldSchema = fieldSchema.optional();
        }
        shape[key] = fieldSchema;
      }

      let result: ZodTypeAny = z.object(shape);
      if (schema.nullable) result = result.nullable();
      if (schema.description) result = result.describe(schema.description);
      return result;
    }

    default:
      return z.any();
  }
}

/**
 * Format an error into a human-readable message.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Convert an OpenAPI path to an MCP tool name.
 * /project.all → project_all
 * /api/project.all → project_all
 */
export function pathToToolName(path: string): string {
  return path
    .replace(/^\/api\//, "/")
    .replace(/^\//, "")
    .replace(/\./g, "_")
    .replace(/\//g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}
