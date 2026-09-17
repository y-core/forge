import { describeTarget } from "../target";
import type { DeploymentTarget } from "../types";
import { CF_ERROR_CODES, SURFACE_PERMISSIONS } from "./endpoints";
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

/** A detail string for a failed call against `target`. */
export function describeCfFailure(e: CfApiClientError, target: DeploymentTarget, options: DescribeCfFailureOptions = {}): string {
  const kind = classifyCfError(e);
  switch (kind) {
    case "not-found":
      return `${describeTarget(target)} not found: ${target.name}`;
    case "auth":
      return describeAuthFailure(e, target);
    case "network":
      return options.redactMessage ? "network error" : `network error — ${e.message}`;
    case "other":
      if (!options.redactMessage) return e.message;
      return describeRedacted(e);
  }
}

function describeAuthFailure(e: CfApiClientError, target: DeploymentTarget): string {
  const code = e.cfErrors?.[0]?.code;
  const permission = SURFACE_PERMISSIONS[target.kind];
  return [
    `auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "${permission}"`,
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
