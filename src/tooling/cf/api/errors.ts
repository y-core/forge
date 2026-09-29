import { WORKER_SURFACE } from "../target";
import { CF_ERROR_CODES, WORKER_PERMISSION } from "./endpoints";
import type { CfApiClientError } from "./types";
import type { CfFailureKind, DescribeCfFailureOptions } from "./types";

/** Classifies a Cloudflare failure by envelope error code, falling back to HTTP status. */
export function classifyCfError(e: CfApiClientError): CfFailureKind {
  if (e.kind === "network") return "network";

  const codes = e.cfErrors?.map((c) => c.code) ?? [];
  if (codes.some((c) => (CF_ERROR_CODES.notFound as readonly number[]).includes(c))) return "not-found";
  if (codes.some((c) => (CF_ERROR_CODES.auth as readonly number[]).includes(c))) return "auth";

  // Cloudflare's status does not track the failure kind — an auth failure arrives as HTTP 400 — so it is only a fallback.
  if (e.statusCode === 404) return "not-found";
  if (e.statusCode === 401 || e.statusCode === 403) return "auth";

  return "other";
}

/** A detail string for a failed call against the Worker `scriptName`. */
export function describeCfFailure(e: CfApiClientError, scriptName: string, options: DescribeCfFailureOptions = {}): string {
  const kind = classifyCfError(e);
  switch (kind) {
    case "not-found":
      return `${WORKER_SURFACE} not found: ${scriptName}`;
    case "auth":
      return describeAuthFailure(e);
    case "network":
      return options.redactMessage ? "network error" : `network error — ${e.message}`;
    case "other":
      if (!options.redactMessage) return e.message;
      return describeRedacted(e);
  }
}

function describeAuthFailure(e: CfApiClientError): string {
  const code = e.cfErrors?.[0]?.code;
  return [
    `auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "${WORKER_PERMISSION}"`,
    " (Read to report, Edit to change)",
    code !== undefined ? ` · code ${code}` : "",
  ].join("");
}

/** An "other" failure rendered from structure alone — no upstream text. */
function describeRedacted(e: CfApiClientError): string {
  const code = e.cfErrors?.[0]?.code;
  const parts = [
    "request failed",
    code !== undefined ? `Cloudflare error ${code}` : undefined,
    e.statusCode !== undefined ? `HTTP ${e.statusCode}` : undefined,
  ].filter(Boolean);
  return `${parts.join(" — ")} (message withheld: it can echo the request body)`;
}
