/**
 * HTTP client for Dokploy API with x-api-key header authentication.
 */

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ApiResponse {
  status: number;
  data: unknown;
  ok: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
// GET is idempotent — safe to retry on 5xx/429 and network errors
const RETRY_DELAYS_MS = [500, 1500];

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    const envTimeout = Number(process.env.DOKPLOY_TIMEOUT_MS);
    this.timeoutMs =
      config.timeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
  }

  async request(
    method: string,
    path: string,
    params?: Record<string, unknown>,
    queryParams?: Record<string, unknown>
  ): Promise<ApiResponse> {
    const url = new URL(`${this.baseUrl}${path}`);
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };

    const query = method === "GET" ? { ...params, ...queryParams } : queryParams;
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    if (method !== "GET" && params) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params);
    }

    const maxAttempts = method === "GET" ? RETRY_DELAYS_MS.length + 1 : 1;

    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      }
      try {
        const response = await fetch(url.toString(), {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if ((response.status >= 500 || response.status === 429) && attempt < maxAttempts - 1) {
          continue;
        }

        let data: unknown;
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          status: response.status,
          data,
          ok: response.ok,
        };
      } catch (err) {
        if (attempt >= maxAttempts - 1) throw err;
      }
    }
  }

  async get(
    path: string,
    params?: Record<string, unknown>
  ): Promise<ApiResponse> {
    return this.request("GET", path, params);
  }
}
