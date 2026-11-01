import { err, ok } from "../../../result/result";
import type { Result } from "../../../result/types";
import { describeValidationIssue } from "../../../validation/format-issues";
import { v } from "../../../validation/validation";
import type { CfAuth } from "../types";
import { CF_ENVELOPE } from "./operations";
import { CfApiClientError } from "./types";
import type { CfApiError } from "./types";
import type { CfClient } from "./types";
import type { CfListOperation } from "./types";
import type { CfOperation } from "./types";
import type { CfPaging } from "./types";

const BASE_URL = "https://api.cloudflare.com/client/v4";
const PER_PAGE = 100;

type CfEnvelope = v.InferOutput<typeof CF_ENVELOPE>;
type CfEnvelopeError = CfEnvelope["errors"][number];
type CfResultInfo = CfEnvelope["result_info"];

interface CfReply {
  envelope: CfEnvelope;
  status: number;
}

type ListStep = { kind: "page" } | { kind: "cursor"; cursor: string } | { kind: "done" } | { kind: "refuse"; reason: string };

function nextListPage(paging: CfPaging, info: CfResultInfo, page: number, received: number, previousCursor: string | undefined): ListStep {
  const unpaged: ListStep =
    received < PER_PAGE
      ? { kind: "done" }
      : { kind: "refuse", reason: `page ${page} came back full with no paging metadata, so the listing may be incomplete` };

  if (paging === "cursor") {
    const cursor = info?.cursor;
    if (cursor && cursor === previousCursor) return { kind: "refuse", reason: `the API returned cursor ${cursor} twice` };
    if (cursor) return { kind: "cursor", cursor };
    return info ? { kind: "done" } : unpaged;
  }

  const perPage = info?.per_page !== undefined && info.per_page > 0 ? info.per_page : PER_PAGE;
  const pages = info?.total_pages ?? (info?.total_count !== undefined ? Math.ceil(info.total_count / perPage) : undefined);
  if (pages === undefined) return unpaged;
  if (page >= pages) return { kind: "done" };
  if (received === 0) return { kind: "refuse", reason: `page ${page} of ${pages} came back empty` };
  return { kind: "page" };
}

const hasCode = (item: CfEnvelopeError): item is CfApiError => item.code !== undefined;

function describeShapeField(issue: v.BaseIssue<unknown>, root: string): string {
  const field = issue.path !== undefined && issue.path.length > 0 ? describeValidationIssue(issue) : root;
  return issue.expected !== null ? `${field} (expected ${issue.expected})` : field;
}

// Built from field paths and expected types alone: an issue's `message` and `input` quote the received value.
function shapeRefusal(operation: string, issues: readonly v.BaseIssue<unknown>[], root: string, statusCode: number): CfApiClientError {
  const fields = [...new Set(issues.map((issue) => describeShapeField(issue, root)))].join(", ");
  return new CfApiClientError("schema", `${operation}: unexpected response shape at ${fields}`, { statusCode });
}

function parseResult<T>(operation: CfOperation<T>, reply: CfReply): Result<T, CfApiClientError> {
  const parsed = v.safeParse(operation.result, reply.envelope.result);
  return parsed.success ? ok(parsed.output) : err(shapeRefusal(operation.name, parsed.issues, "result", reply.status));
}

export function createCfClient(auth: Pick<CfAuth, "apiToken">, fetchFn: typeof globalThis.fetch = globalThis.fetch, timeoutMs = 30_000): CfClient {
  async function requestEnvelope(method: string, path: string, operation: string, body?: unknown): Promise<Result<CfReply, CfApiClientError>> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const timedOut = (): Result<never, CfApiClientError> => err(new CfApiClientError("network", `timed out after ${timeoutMs}ms`));
    let res: Response;
    try {
      const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
      res = await fetchFn(`${BASE_URL}${path}`, {
        method,
        headers: isFormData
          ? { Authorization: `Bearer ${auth.apiToken}` }
          : { Authorization: `Bearer ${auth.apiToken}`, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
        signal: deadline,
      });
    } catch (thrown) {
      if (deadline.aborted) return timedOut();
      return err(new CfApiClientError("network", `Network error: ${(thrown as Error).message}`));
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      if (deadline.aborted) return timedOut();
      return err(new CfApiClientError("parse", `Failed to parse response (HTTP ${res.status})`, { statusCode: res.status }));
    }

    const parsed = v.safeParse(CF_ENVELOPE, data);
    if (!parsed.success) {
      if (!res.ok) return err(new CfApiClientError("api", `API error (HTTP ${res.status})`, { statusCode: res.status }));
      return err(shapeRefusal(operation, parsed.issues, "body", res.status));
    }

    const envelope = parsed.output;
    if (!envelope.success) {
      const msg = envelope.errors[0]?.message ?? `API error (HTTP ${res.status})`;
      return err(new CfApiClientError("api", msg, { statusCode: res.status, cfErrors: envelope.errors.filter(hasCode) }));
    }

    return ok({ envelope, status: res.status });
  }

  async function request<T>(method: string, path: string, operation: CfOperation<T>, body?: unknown): Promise<Result<T, CfApiClientError>> {
    const reply = await requestEnvelope(method, path, operation.name, body);
    if (!reply.ok) return reply;
    return parseResult(operation, reply.data);
  }

  async function list<T>(path: string, operation: CfListOperation<T>): Promise<Result<T[], CfApiClientError>> {
    const { paging } = operation;
    const sep = path.includes("?") ? "&" : "?";
    const gathered: T[] = [];
    let page = 1;
    let cursor: string | undefined;

    for (;;) {
      const query =
        paging === "page"
          ? `per_page=${PER_PAGE}&page=${page}`
          : `per_page=${PER_PAGE}${cursor !== undefined ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const reply = await requestEnvelope("GET", `${path}${sep}${query}`, operation.name);
      if (!reply.ok) return reply;

      const pageItems = parseResult(operation, reply.data);
      if (!pageItems.ok) return pageItems;
      gathered.push(...pageItems.data);

      const next = nextListPage(paging, reply.data.envelope.result_info, page, pageItems.data.length, cursor);
      if (next.kind === "done") return ok(gathered);
      if (next.kind === "refuse") return err(new CfApiClientError("paging", `${operation.name}: ${next.reason}`));
      if (next.kind === "cursor") cursor = next.cursor;
      page++;
    }
  }

  return {
    get: <T>(path: string, operation: CfOperation<T>) => request("GET", path, operation),
    list,
    post: <T>(path: string, body: unknown, operation: CfOperation<T>) => request("POST", path, operation, body),
    put: <T>(path: string, body: unknown, operation: CfOperation<T>) => request("PUT", path, operation, body),
  };
}
