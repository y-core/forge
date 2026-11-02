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

/** The root every Cloudflare REST path is resolved against. @internal */
export const CF_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const PER_PAGE = 100;
const MAX_LIST_PAGES = 1_000;
const RETRY_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

type CfEnvelope = v.InferOutput<typeof CF_ENVELOPE>;
type CfEnvelopeError = CfEnvelope["errors"][number];
type CfResultInfo = CfEnvelope["result_info"];

interface CfReply {
  envelope: CfEnvelope;
  status: number;
}

type ListStep = { kind: "page" } | { kind: "cursor"; cursor: string } | { kind: "done" } | { kind: "refuse"; reason: string };

function readListStep(paging: CfPaging, info: CfResultInfo, page: number, received: number, seenCursors: ReadonlySet<string>): ListStep {
  const unpaged: ListStep =
    received < PER_PAGE
      ? { kind: "done" }
      : { kind: "refuse", reason: `page ${page} came back full with no paging metadata, so the listing may be incomplete` };

  if (paging === "cursor") {
    const cursor = info?.cursor;
    if (cursor && seenCursors.has(cursor))
      return { kind: "refuse", reason: `page ${page} returned cursor ${cursor}, which an earlier page already returned` };
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

function nextListPage(paging: CfPaging, info: CfResultInfo, page: number, received: number, seenCursors: ReadonlySet<string>): ListStep {
  const step = readListStep(paging, info, page, received, seenCursors);
  if (step.kind === "done" || step.kind === "refuse" || page < MAX_LIST_PAGES) return step;
  return { kind: "refuse", reason: `the listing reached the ${MAX_LIST_PAGES}-page cap, so it may be incomplete` };
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

async function readEnvelope(
  res: Response,
  operation: string,
  deadline: AbortSignal,
  timedOut: () => Result<never, CfApiClientError>,
): Promise<Result<CfReply, CfApiClientError>> {
  const retryAfter = res.headers.get("Retry-After");
  const refusal = retryAfter === null ? { statusCode: res.status } : { statusCode: res.status, retryAfter };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (deadline.aborted) return timedOut();
    return err(new CfApiClientError("parse", `Failed to parse response (HTTP ${res.status})`, refusal));
  }

  const parsed = v.safeParse(CF_ENVELOPE, data);
  if (!parsed.success) {
    if (!res.ok) return err(new CfApiClientError("api", `API error (HTTP ${res.status})`, refusal));
    return err(shapeRefusal(operation, parsed.issues, "body", res.status));
  }

  const envelope = parsed.output;
  if (!envelope.success) {
    const msg = envelope.errors[0]?.message ?? `API error (HTTP ${res.status})`;
    return err(new CfApiClientError("api", msg, { ...refusal, cfErrors: envelope.errors.filter(hasCode) }));
  }

  return ok({ envelope, status: res.status });
}

function waitOnRealClock(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFailure(e: CfApiClientError): boolean {
  return e.kind === "network" || e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
}

/** How long a `Retry-After` header asks to wait from `now`, or undefined when it names no wait forge can read. @internal */
export function readRetryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!HTTP_DATE.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function retryDelayMs(tried: number, retryAfterMs: number | undefined): number {
  return Math.min(RETRY_MAX_DELAY_MS, retryAfterMs ?? RETRY_BASE_DELAY_MS * 2 ** (tried - 1));
}

function refuseAfterRetries(operation: string, last: CfApiClientError): CfApiClientError {
  const lastAnswer = last.statusCode === undefined ? "failed in transport" : `answered HTTP ${last.statusCode}`;
  return new CfApiClientError(last.kind, `${operation}: gave up after ${RETRY_ATTEMPTS} attempts; the last ${lastAnswer}: ${last.message}`, {
    ...(last.statusCode === undefined ? {} : { statusCode: last.statusCode }),
    ...(last.cfErrors === undefined ? {} : { cfErrors: last.cfErrors }),
    ...(last.retryAfter === undefined ? {} : { retryAfter: last.retryAfter }),
  });
}

function parseResult<T>(operation: CfOperation<T>, reply: CfReply): Result<T, CfApiClientError> {
  const parsed = v.safeParse(operation.result, reply.envelope.result);
  return parsed.success ? ok(parsed.output) : err(shapeRefusal(operation.name, parsed.issues, "result", reply.status));
}

export function createCfClient(
  auth: Pick<CfAuth, "apiToken">,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 30_000,
  sleep: (ms: number) => Promise<void> = waitOnRealClock,
): CfClient {
  async function attemptEnvelope(method: string, path: string, operation: string, body?: unknown): Promise<Result<CfReply, CfApiClientError>> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const timedOut = (): Result<never, CfApiClientError> => err(new CfApiClientError("network", `timed out after ${timeoutMs}ms`));
    let res: Response;
    try {
      const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
      res = await fetchFn(`${CF_API_BASE_URL}${path}`, {
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
    return readEnvelope(res, operation, deadline, timedOut);
  }

  async function requestEnvelope(
    method: string,
    path: string,
    operation: Pick<CfOperation<unknown>, "name" | "idempotent">,
    body?: unknown,
  ): Promise<Result<CfReply, CfApiClientError>> {
    for (let tried = 1; ; tried += 1) {
      const reply = await attemptEnvelope(method, path, operation.name, body);
      if (reply.ok || operation.idempotent !== true || !isTransientFailure(reply.error)) return reply;
      if (tried >= RETRY_ATTEMPTS) return err(refuseAfterRetries(operation.name, reply.error));
      await sleep(retryDelayMs(tried, readRetryAfterMs(reply.error.retryAfter ?? null, Date.now())));
    }
  }

  async function request<T>(method: string, path: string, operation: CfOperation<T>, body?: unknown): Promise<Result<T, CfApiClientError>> {
    const reply = await requestEnvelope(method, path, operation, body);
    if (!reply.ok) return reply;
    return parseResult(operation, reply.data);
  }

  async function list<T>(path: string, operation: CfListOperation<T>): Promise<Result<T[], CfApiClientError>> {
    const { paging } = operation;
    const sep = path.includes("?") ? "&" : "?";
    const gathered: T[] = [];
    let page = 1;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const query =
        paging === "page"
          ? `per_page=${PER_PAGE}&page=${page}`
          : `per_page=${PER_PAGE}${cursor !== undefined ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const reply = await requestEnvelope("GET", `${path}${sep}${query}`, operation);
      if (!reply.ok) return reply;

      const pageItems = parseResult(operation, reply.data);
      if (!pageItems.ok) return pageItems;
      gathered.push(...pageItems.data);

      const next = nextListPage(paging, reply.data.envelope.result_info, page, pageItems.data.length, seenCursors);
      if (next.kind === "done") return ok(gathered);
      if (next.kind === "refuse") return err(new CfApiClientError("paging", `${operation.name}: ${next.reason}`));
      if (next.kind === "cursor") {
        cursor = next.cursor;
        seenCursors.add(cursor);
      }
      page++;
    }
  }

  return {
    get: <T>(path: string, operation: CfOperation<T>) => request("GET", path, operation),
    list,
    post: <T>(path: string, body: unknown, operation: CfOperation<T>) => request("POST", path, operation, body),
    put: <T>(path: string, body: unknown, operation: CfOperation<T>) => request("PUT", path, operation, body),
    patch: <T>(path: string, body: unknown, operation: CfOperation<T>) => request("PATCH", path, operation, body),
  };
}
