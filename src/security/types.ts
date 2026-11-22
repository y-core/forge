import type { RequestContext } from "@remix-run/fetch-router";

import type { AppContext, Refusal, RefuseHook } from "../context/types";
import type { GuardResult, Result } from "../result/types";
import type { NONCE } from "./nonce";
import type { UNSAFE_CSP_SOURCES } from "./unsafe";

/** A deliberate CSP weakening a caller opts into by importing it; the string spelling is refused. @public */
export type UnsafeCspSource = (typeof UNSAFE_CSP_SOURCES)[number]["placeholder"];

/** A single CSP source value — a string literal, the `NONCE` placeholder, or a deliberate unsafe opt-out. @public */
export type CspSourceValue = string | typeof NONCE | UnsafeCspSource;

type CspValue = CspSourceValue[];

/** URL parts derived from a base URL. @public */
export interface ParsedUrl {
  origin: string;
  hostname: string;
  protocol: string;
}

/** Extended parsed URL with derived allowed origins for CORS/origin checks. @public */
export interface BaseUrlConfig extends ParsedUrl {
  allowedOrigins: string[];
}

/** Permissions-Policy allowlists; omitted features default to `()` (disabled). @public */
export interface PermissionsPolicyOptions {
  microphone?: string[];
  camera?: string[];
  geolocation?: string[];
  payment?: string[];
}

/** Strict-Transport-Security tokens; each omitted field keeps forge's default of two years, `includeSubDomains` and `preload`. @public */
export interface HstsOptions {
  /** Seconds the browser holds the policy; a non-negative integer. */
  maxAge?: number | undefined;
  includeSubDomains?: boolean | undefined;
  /** Consent to the browsers' preload list, which takes months to leave again. */
  preload?: boolean | undefined;
}

/** Trusted Types enforcement: the policy names the page may create. @public */
export interface TrustedTypesOptions {
  /** `[]` renders `'none'`. */
  policies: string[];
  allowDuplicates?: boolean | undefined;
  /** `false` omits `require-trusted-types-for 'script'`; on by default. */
  require?: boolean | undefined;
}

/** Where the browser reports CSP violations. @public */
export interface CspReportingOptions {
  /** An absolute https URL or a root-relative path, emitted verbatim in both `Reporting-Endpoints` and the `report-uri` fallback. */
  endpoint: string;
  /** Defaults to `csp-endpoint`. */
  group?: string | undefined;
}

/** The directives one Content-Security-Policy is built from. @public */
export interface CspDirectiveOptions {
  scriptSrc?: CspValue;
  connectSrc?: CspValue;
  frameSrc?: CspValue;
  imgSrc?: CspValue;
  styleSrc?: CspValue;
  fontSrc?: CspValue;
  workerSrc?: CspValue;
  childSrc?: CspValue;
  trustedTypes?: TrustedTypesOptions;
}

/** The CSP family: the enforced directives, violation reporting, and a Report-Only candidate. @public */
export interface CspOptions extends CspDirectiveOptions {
  reporting?: CspReportingOptions;
  /** Each field stated here replaces the enforced policy's; an unstated one is inherited. */
  reportOnly?: CspDirectiveOptions;
}

/** CSP options, HSTS, Permissions-Policy, and cross-origin policy options for security headers. @public */
export interface SecurityHeadersOptions extends CspOptions {
  /** `false` omits the header. */
  hsts?: false | HstsOptions;
  permissionsPolicy?: PermissionsPolicyOptions;
  crossOriginOpenerPolicy?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  crossOriginResourcePolicy?: "same-origin" | "same-site" | "cross-origin";
  crossOriginEmbedderPolicy?: "require-corp" | "credentialless";
  /** Defaults to `strict-origin-when-cross-origin`; `no-referrer` is excluded, as it would empty the Referer fallback of origin checks. */
  referrerPolicy?: "strict-origin-when-cross-origin" | "same-origin" | "strict-origin";
}

/** `SecurityHeadersOptions` plus an explicit CSP nonce for `applySecurityHeaders`. @public */
export interface ApplySecurityHeadersOptions extends SecurityHeadersOptions {
  nonce?: string;
}

/** Result of an Origin/Referer allowlist check. @public */
export type OriginResult = GuardResult<"missing" | "disallowed">;

/** Options controlling how allowed origins are derived from a base URL. @public */
export interface DeriveAllowedOriginsOptions {
  includeWww?: boolean;
}

/** Result of the Fetch-Metadata cross-origin check (`checkCrossOriginProtection`). @public */
export type CrossOriginResult = GuardResult<"missing-fetch-metadata" | "cross-site" | "same-site">;

/** Why `originProtection` refused a request — a server diagnostic, never echoed to the sender. @public */
export type OriginRefusal = Extract<Refusal, { guard: "origin" }>["reason"];

/** Options for the Origin/Referer allowlist middleware, with per-request origin resolution. @public */
export interface OriginProtectionOptions<Bindings = Record<string, unknown>> {
  /** The app's own origin must appear here, or its own same-origin mutations are rejected. */
  allowedOrigins: string[] | ((c: AppContext<Bindings>) => string[]);
  /** Answers a refused request in place of the chain's hook, or declines with `undefined` to it; with neither answering, a bare 403 "Forbidden". */
  onRefuse?: RefuseHook<Bindings>;
  /** `"allow"` admits a mutation carrying no `Origin`, `Referer` or `Sec-Fetch-Site`, for callers that are not browsers; defaults to `"refuse"`. */
  missing?: "refuse" | "allow";
}

/** Cloudflare's Workers Rate Limiting binding, under the name `wrangler types` and `forge cf gen env` give it. @public */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Every rate-limit binding's window by binding name, as the generated `RATELIMITS` declares it. @internal */
export type RateLimitTable = Readonly<Record<string, { readonly limit: number; readonly period: number }>>;

/** Options for the rate-limit middleware: the binding by name, the methods it counts, keying, and the refusal hook. @public */
export type RateLimitOptions<Bindings = Record<string, unknown>> = {
  /** The binding's name on `env`, which must be a key of the chain's `rateLimits`. */
  binding: string;
  /** The methods the limit counts; every method by default. A request by any other passes without spending. */
  methods?: readonly string[];
  /** Answers a `429` or `503` in place of the chain's hook, or declines with `undefined` to it; with neither answering, forge's plain-text default. */
  onRefuse?: RefuseHook<Bindings>;
} & (
  | {
      /** Replaces the client-IP key whatever the chain's trust, for non-Cloudflare deployments; to extend the IP key, pass `keySuffix`. */
      key?: (c: AppContext<Bindings>) => string;
      keySuffix?: never;
    }
  | {
      key?: never;
      /** Appended to the trusted client IP as `<ip>:<suffix>`, keyed only under the chain's trust. */
      keySuffix?: (c: AppContext<Bindings>) => string;
    }
);

/** CORS middleware options: allowed origins, methods, allowed and exposed headers, credentials, and preflight cache. @public */
export interface CorsOptions<Bindings = Record<string, unknown>> {
  /** Exact allowed origins or subdomain patterns ("https://*.example.com"), or a resolver answering them once per `env` from that `env`. */
  origins: readonly string[] | ((env: Bindings) => readonly string[] | Promise<readonly string[]>);
  methods?: string[];
  allowedHeaders?: string[];
  /** Response headers a calling script may read; sent on allowed actual responses, never a preflight. `"*"` is refused with `credentials`. */
  exposedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds. */
  maxAge?: number;
}

/** Bare variable record set by `requestId`. @public */
export type RequestIdContext = { requestId: string };

/** Secrets, limits and clock that `createWebhookSigning` fixes for every `sign` and `verify`. @public */
export interface WebhookSigningOptions {
  /** Every active `whsec_` secret; `sign` emits one signature per entry and `verify` accepts a signature under any one. */
  readonly secrets: readonly string[];
  /** Allowed clock skew in seconds, in either direction; defaults to 300. */
  readonly toleranceSeconds?: number;
  /** Body ceiling in bytes, checked against `Content-Length` and then metered; defaults to 1 MiB. */
  readonly maxBytes?: number;
  /** Milliseconds since the epoch; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The message `sign` signs. @public */
export interface WebhookSignOptions {
  /** Unique per message and reused on every retry, so a receiver can deduplicate; must not contain ".". */
  readonly id: string;
  readonly body: string | Uint8Array<ArrayBuffer>;
}

/** A Standard Webhooks signer and verifier bound to the secrets it was created with. @public */
export interface WebhookSigning {
  /** Signs a body under every active secret, answering the Standard Webhooks headers. */
  sign(message: WebhookSignOptions): Promise<WebhookSignatureHeaders>;
  /** Checks a request against any active secret, answering the exact signed body bytes. */
  verify(request: Request): Promise<Result<VerifiedWebhook, WebhookRefusal>>;
}

/** The Standard Webhooks headers `sign` produces, assignable to `HeadersInit`. @public */
export type WebhookSignatureHeaders = { readonly "webhook-id": string; readonly "webhook-timestamp": string; readonly "webhook-signature": string };

/** A webhook whose signature matched, carrying the exact bytes that were signed. @public */
export interface VerifiedWebhook {
  readonly id: string;
  /** Seconds since the epoch, as signed. */
  readonly timestamp: number;
  readonly body: Uint8Array<ArrayBuffer>;
}

/** Why `verify` refused a request — a server diagnostic, never echoed to the sender. @public */
export type WebhookRefusal =
  | "missing-header"
  | "invalid-timestamp"
  | "timestamp-too-old"
  | "timestamp-too-new"
  | "invalid-signature"
  | "body-too-large"
  | "signature-mismatch";

/** One limit's check: the refusal it answers, or `undefined` to admit the request. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- params and bindings are irrelevant to the check
export type RateLimitCheck = (context: RequestContext<any, any>) => Promise<Response | undefined>;

/** Whether a request may pass a rate limiter whose binding is absent. @internal */
export type RelaxAbsentLimiter = () => boolean;

/** Whether a request without Fetch Metadata headers may pass cross-origin protection. @internal */
export type RelaxMissingFetchMetadata = () => boolean;

/** The origins, beyond the configured ones, an app's bindings admit during development. @internal */
export type RelaxExtraOrigins = (env: unknown) => readonly string[];

/** Answers one refusal and logs it as `security.<guard>.refused`; `cause` is the failure behind a `503`. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
export type RefusalAnswer = (context: RequestContext<any, any>, refusal: Refusal, cause?: unknown) => Promise<Response>;
