import type { Result } from "../../../result/result";
import { err, ok } from "../../../result/result";
import type { CfAuth } from "../types";
import { CfApiClientError, type CfApiResponse } from "./types";

const BASE_URL = "https://api.cloudflare.com/client/v4";

export interface CfClient {
  get<T>(path: string): Promise<Result<T, CfApiClientError>>;
  list<T>(path: string): Promise<Result<T[], CfApiClientError>>;
  post<T>(path: string, body: unknown): Promise<Result<T, CfApiClientError>>;
  put<T>(path: string, body: unknown): Promise<Result<T, CfApiClientError>>;
  patch<T>(path: string, body: unknown): Promise<Result<T, CfApiClientError>>;
  delete<T>(path: string): Promise<Result<T, CfApiClientError>>;
}

export function createCfClient(auth: Pick<CfAuth, "apiToken">, fetchFn: typeof globalThis.fetch = globalThis.fetch): CfClient {
  async function requestEnvelope<T>(method: string, path: string, body?: unknown): Promise<Result<CfApiResponse<T>, CfApiClientError>> {
    let res: Response;
    try {
      const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
      res = await fetchFn(`${BASE_URL}${path}`, {
        method,
        headers: isFormData
          ? { Authorization: `Bearer ${auth.apiToken}` }
          : { Authorization: `Bearer ${auth.apiToken}`, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
      });
    } catch (thrown) {
      return err(new CfApiClientError("network", `Network error: ${(thrown as Error).message}`));
    }

    let data: CfApiResponse<T>;
    try {
      data = (await res.json()) as CfApiResponse<T>;
    } catch {
      return err(new CfApiClientError("parse", `Failed to parse response (HTTP ${res.status})`, { statusCode: res.status }));
    }

    if (!data.success) {
      const msg = data.errors?.[0]?.message ?? `API error (HTTP ${res.status})`;
      return err(new CfApiClientError("api", msg, { statusCode: res.status, cfErrors: data.errors }));
    }

    return ok(data);
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<Result<T, CfApiClientError>> {
    const res = await requestEnvelope<T>(method, path, body);
    if (!res.ok) return res;
    return ok(res.data.result);
  }

  // Follows Cloudflare's `result_info` pagination, accumulating every page into one array.
  async function list<T>(path: string): Promise<Result<T[], CfApiClientError>> {
    const perPage = 100;
    const sep = path.includes("?") ? "&" : "?";
    const items: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await requestEnvelope<T[]>("GET", `${path}${sep}per_page=${perPage}&page=${page}`);
      if (!res.ok) return res;

      const pageItems = res.data.result ?? [];
      items.push(...pageItems);

      const info = res.data.result_info;
      hasMore = !!info && pageItems.length > 0 && items.length < info.total_count;
      page++;
    }

    return ok(items);
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    list: <T>(path: string) => list<T>(path),
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}
