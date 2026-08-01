/**
 * Gateway mode — exposes the whole Dokploy API through 4 tools instead of 500+,
 * cutting the tools/list payload from ~60k tokens to ~1k.
 *
 *   dokploy_search    find endpoints by keyword          (readOnlyHint)
 *   dokploy_describe  show an endpoint's parameters      (readOnlyHint)
 *   dokploy_call      invoke a read-only (GET) endpoint  (readOnlyHint)
 *   dokploy_mutate    invoke a writing endpoint          (destructiveHint)
 *
 * Read and write are separate tools on purpose: a single do-everything tool
 * would erase the readOnly/destructive distinction, leaving clients unable to
 * gate dangerous calls.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "./apiClient.js";
import {
  type Endpoint,
  executeEndpoint,
  validateParams,
  errorResult,
  textResult,
} from "./registry.js";

const DEFAULT_SEARCH_LIMIT = 25;
const MAX_SEARCH_LIMIT = 100;

/**
 * Score an endpoint against query terms.
 * Returns how many terms matched and the total weight, so callers can
 * prefer all-terms matches but still fall back to partial ones.
 */
function score(endpoint: Endpoint, terms: string[]): { matched: number; weight: number } {
  if (terms.length === 0) return { matched: 1, weight: 1 };
  const name = endpoint.name.toLowerCase();
  const desc = endpoint.description.toLowerCase();
  let matched = 0;
  let weight = 0;

  for (const term of terms) {
    let s = 0;
    if (name === term) s += 100;
    else if (name.startsWith(term)) s += 40;
    else if (name.includes(term)) s += 25;
    if (desc.includes(term)) s += 8;
    if (endpoint.tags.some((t) => t.toLowerCase().includes(term))) s += 5;
    if (s > 0) matched++;
    weight += s;
  }

  // Curated descriptions are the ones a model can actually reason about
  if (weight > 0 && endpoint.curated) weight += 3;
  return { matched, weight };
}

/**
 * Rank endpoints: require every term first, and only if that finds nothing
 * fall back to any-term matches — a natural phrase like "add domain ssl"
 * shouldn't come back empty just because "add" appears nowhere in the API.
 */
function rank(all: Endpoint[], terms: string[]): Endpoint[] {
  const scored = all
    .map((e) => ({ e, ...score(e, terms) }))
    .filter((x) => x.matched > 0)
    .sort((a, b) => b.matched - a.matched || b.weight - a.weight || a.e.name.localeCompare(b.e.name));

  const strict = scored.filter((x) => x.matched === Math.max(terms.length, 1));
  return (strict.length > 0 ? strict : scored).map((x) => x.e);
}

export function registerGatewayTools(
  server: McpServer,
  endpoints: Map<string, Endpoint>,
  apiClient: ApiClient
): number {
  const all = [...endpoints.values()];
  const hasWrites = all.some((e) => !e.readOnly);
  let count = 0;

  const catalogHint =
    `Dokploy API gateway over ${all.length} endpoints. ` +
    `Workflow: dokploy_search (find) → dokploy_describe (parameters) → ` +
    `dokploy_call / dokploy_mutate (invoke).`;

  server.registerTool(
    "dokploy_search",
    {
      description:
        `Search Dokploy API endpoints by keyword. ${catalogHint} ` +
        `Query terms are ANDed; try resource names like "application deploy", "postgres backup", "domain".`,
      inputSchema: {
        query: z
          .string()
          .describe('Keywords, e.g. "deploy application", "list projects", "docker containers". Empty lists everything.'),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional()
          .describe(`Max results (default ${DEFAULT_SEARCH_LIMIT})`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const ranked = rank(all, terms);

      const max = limit ?? DEFAULT_SEARCH_LIMIT;
      const shown = ranked.slice(0, max);

      if (shown.length === 0) {
        return textResult(
          JSON.stringify({
            matches: [],
            hint: `No endpoint matches "${query}". Try a single broader term (e.g. "application", "compose", "backup"), or call dokploy_search with an empty query to browse.`,
          })
        );
      }

      return textResult(
        JSON.stringify({
          total_matches: ranked.length,
          showing: shown.length,
          endpoints: shown.map((e) => ({
            name: e.name,
            kind: e.readOnly ? "read" : e.destructive ? "write:destructive" : "write",
            description: e.description,
            required: e.fields.filter((f) => f.required).map((f) => f.name),
          })),
          next: "dokploy_describe(<name>) for full parameters",
        })
      );
    }
  );
  count++;

  server.registerTool(
    "dokploy_describe",
    {
      description:
        "Show an endpoint's full parameter schema before calling it. Use the exact name returned by dokploy_search.",
      inputSchema: {
        endpoint: z.string().describe('Endpoint name, e.g. "application_deploy"'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ endpoint }) => {
      const found = endpoints.get(endpoint);
      if (!found) return errorResult(unknownEndpoint(endpoint, all));

      return textResult(
        JSON.stringify({
          name: found.name,
          kind: found.readOnly ? "read" : found.destructive ? "write:destructive" : "write",
          invoke_with: found.readOnly ? "dokploy_call" : "dokploy_mutate",
          description: found.description,
          http: `${found.method} ${found.path}`,
          parameters: found.fields.map((f) => ({
            name: f.name,
            type: f.type,
            required: f.required,
            ...(f.description ? { description: f.description } : {}),
            ...(f.enum ? { enum: f.enum } : {}),
          })),
        })
      );
    }
  );
  count++;

  server.registerTool(
    "dokploy_call",
    {
      description:
        `Invoke a READ-ONLY Dokploy endpoint (GET) and return its data. ${catalogHint} ` +
        `Refuses writing endpoints — use dokploy_mutate for those.`,
      inputSchema: {
        endpoint: z.string().describe('Read endpoint name, e.g. "project_all"'),
        params: z.record(z.any()).optional().describe("Endpoint parameters as an object"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ endpoint, params }) => {
      const found = endpoints.get(endpoint);
      if (!found) return errorResult(unknownEndpoint(endpoint, all));
      if (!found.readOnly) {
        return errorResult(
          `"${endpoint}" modifies state (${found.method}) and cannot run through dokploy_call. ` +
            `Use dokploy_mutate instead — the split exists so clients can gate writes.`
        );
      }
      return invoke(found, apiClient, params);
    }
  );
  count++;

  // Nothing to mutate in read-only mode — don't advertise a tool that always refuses
  if (hasWrites) {
    server.registerTool(
      "dokploy_mutate",
      {
        description:
          `Invoke a WRITING Dokploy endpoint — creates, updates, deploys, deletes. ${catalogHint} ` +
          `Destructive: confirm intent before calling. Refuses read-only endpoints (use dokploy_call).`,
        inputSchema: {
          endpoint: z.string().describe('Write endpoint name, e.g. "application_deploy"'),
          params: z.record(z.any()).optional().describe("Endpoint parameters as an object"),
        },
        annotations: { destructiveHint: true },
      },
      async ({ endpoint, params }) => {
        const found = endpoints.get(endpoint);
        if (!found) return errorResult(unknownEndpoint(endpoint, all));
        if (found.readOnly) {
          return errorResult(
            `"${endpoint}" is read-only (GET). Use dokploy_call — no need to route it through a destructive tool.`
          );
        }
        return invoke(found, apiClient, params);
      }
    );
    count++;
  }

  return count;
}

async function invoke(
  endpoint: Endpoint,
  apiClient: ApiClient,
  params: unknown
): Promise<ReturnType<typeof textResult>> {
  const validated = validateParams(endpoint, params);
  if (!validated.ok) return errorResult(validated.message);
  try {
    return await executeEndpoint(endpoint, apiClient, validated.value);
  } catch (err) {
    return errorResult(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Unknown name — suggest the closest ones instead of a dead end. */
function unknownEndpoint(name: string, all: Endpoint[]): string {
  // Treat the bad name as a query: its parts still rank the right family,
  // so "aplication_deploy" surfaces application_deploy via its "deploy" half
  const parts = name.toLowerCase().split(/[_.\s]+/).filter(Boolean);
  const stems = parts.flatMap((p) => (p.length > 4 ? [p, p.slice(0, 4)] : [p]));
  const near = rank(all, stems).slice(0, 8).map((e) => e.name);

  return (
    `Unknown endpoint "${name}".` +
    (near.length ? ` Did you mean: ${near.join(", ")}?` : "") +
    ` Use dokploy_search to find the right name.`
  );
}
