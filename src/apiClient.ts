/**
 * HTTP client for Dokploy API with x-api-key header authentication.
 */

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ApiResponse {
  status: number;
  data: unknown;
  ok: boolean;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async request(
    method: string,
    path: string,
    params?: Record<string, unknown>
  ): Promise<ApiResponse> {
    const url = new URL(`${this.baseUrl}${path}`);
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };

    if (method === "GET" && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    } else if (method !== "GET" && params) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params);
    }

    const response = await fetch(url.toString(), init);
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
  }

  async get(
    path: string,
    params?: Record<string, unknown>
  ): Promise<ApiResponse> {
    return this.request("GET", path, params);
  }

  async post(
    path: string,
    body?: Record<string, unknown>
  ): Promise<ApiResponse> {
    return this.request("POST", path, body);
  }
}
