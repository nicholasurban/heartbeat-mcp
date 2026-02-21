import axios, { AxiosInstance, AxiosError } from "axios";

interface CacheEntry {
  data: unknown;
  expires: number;
}

export class HeartbeatAPI {
  private client: AxiosInstance;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTL: number;

  constructor(apiKey: string, cacheTTL = 60_000) {
    this.cacheTTL = cacheTTL;
    this.client = axios.create({
      baseURL: "https://api.heartbeat.chat/v0",
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  private cacheKey(method: string, path: string, params?: Record<string, unknown>): string {
    return `${method}:${path}:${JSON.stringify(params ?? {})}`;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const key = this.cacheKey("GET", path, params);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.data as T;

    // Lazy eviction: prune expired entries when cache grows large
    if (this.cache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (v.expires <= now) this.cache.delete(k);
      }
    }

    const res = await this.request<T>("GET", path, undefined, params);
    this.cache.set(key, { data: res, expires: Date.now() + this.cacheTTL });
    return res;
  }

  async put<T>(path: string, data?: unknown): Promise<T> {
    this.cache.clear();
    return this.request<T>("PUT", path, data);
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    this.cache.clear();
    return this.request<T>("POST", path, data);
  }

  async delete<T>(path: string): Promise<T> {
    this.cache.clear();
    return this.request<T>("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    data?: unknown,
    params?: Record<string, unknown>,
    retries = 3,
  ): Promise<T> {
    try {
      const res = await this.client.request({ method, url: path, data, params });
      return res.data as T;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 429 && retries > 0) {
        const delay = Math.pow(2, 3 - retries) * 1000; // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, delay));
        return this.request<T>(method, path, data, params, retries - 1);
      }
      throw err;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const body = error.response.data;
      const msg =
        typeof body === "object" && body?.message
          ? (body.message as string)
          : JSON.stringify(body);
      switch (status) {
        case 400:
          return `Validation error: ${msg}`;
        case 401:
          return "API key invalid or expired. Check HEARTBEAT_API_KEY.";
        case 404:
          return `Not found: ${msg}`;
        case 429:
          return "Rate limit exceeded after retries. Wait and try again.";
        default:
          return `API error ${status}: ${msg}`;
      }
    }
    if (error.code === "ECONNABORTED") return "Request timed out. Try again.";
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
