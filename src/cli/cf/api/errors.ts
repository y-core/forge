import type { DeploymentTarget } from "../target";
import { describeTarget } from "../target";
import { CF_ERROR_CODES, SURFACE_PERMISSIONS } from "./endpoints";
import type { CfApiClientError } from "./types";

/**
 * Why a Cloudflare call failed, at the granularity a result row cares about.
 *
 * A missing target and a bad token are the two failures a user acts on
 * differently — one means "create it", the other "fix your credentials" — and
 * until this existed they rendered as the same `error` row.
 */
export type CfFailureKind = "not-found" | "auth" | "network" | "other";

/**
 * Classify by envelope error code first. Cloudflare's HTTP status does not track
 * the failure kind — an auth failure arrives as HTTP 400 and a missing object as
 * HTTP 404 — so status is consulted only when no recognised code is present.
 * See `endpoints.ts` for the probed evidence.
 */
export function classifyCfError(e: CfApiClientError): CfFailureKind {
  if (e.kind === "network") return "network";

  const codes = e.cfErrors?.map((c) => c.code) ?? [];
  if (codes.some((c) => (CF_ERROR_CODES.notFound as readonly number[]).includes(c))) return "not-found";
  if (codes.some((c) => (CF_ERROR_CODES.auth as readonly number[]).includes(c))) return "auth";

  if (e.statusCode === 404) return "not-found";
  if (e.statusCode === 401 || e.statusCode === 403) return "auth";

  return "other";
}

export interface DescribeCfFailureOptions {
  /**
   * Never interpolate the upstream message.
   *
   * Cloudflare echoes parts of a rejected request back in its error text, so for a
   * call whose body carried a secret the message is a leak surface. Callers in that
   * position pass `redactMessage` and get the error *code* instead — enough to
   * diagnose, and structurally incapable of carrying a payload.
   */
  redactMessage?: boolean;
}

/**
 * A detail string for a failed call against `target`.
 *
 * The classified kinds never quote upstream text; only "network" and "other" do,
 * because there the message is the sole information available. Those two are what
 * {@link DescribeCfFailureOptions.redactMessage} suppresses.
 */
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

/**
 * An auth failure, naming the permission this surface needs and the code returned.
 *
 * Both halves are stated because Cloudflare conflates them — see
 * {@link CF_ERROR_CODES}. The code is structural, never upstream text, so this is
 * safe on a request that carried a secret.
 */
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
