import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { setPendingHeader } from "../context/pending-headers";
import { mapHandler } from "../testing/route";
import { applySecurityHeaders, createRouteSecurityHeaders, createSecurityHeaders, getNonce, mergeSecurityHeaders } from "./headers";
import { NONCE, TURNSTILE_CSP } from "./nonce";
import type { CspOptions, CspSourceValue, SecurityHeadersOptions } from "./types";
import { UNSAFE_EVAL, UNSAFE_HASHES, UNSAFE_INLINE, WASM_UNSAFE_EVAL } from "./unsafe";

const tokenMessage = (name: string) =>
  `Invalid CSP directive "${name}": source entries must be single CSP source tokens (no whitespace, ';', ',' or control characters)`;

const unsafeMessage = (name: string, token: string, exportName: string) =>
  `Invalid CSP directive "${name}": ${token} is never permitted as a string — import ${exportName} from "@y-core/forge/security" to opt in deliberately`;

const inertInlineMessage = (name: string) =>
  `Invalid CSP directive "${name}": UNSAFE_INLINE has no effect beside a nonce or hash source, which CSP Level 3 has the browser ignore it next to — remove the nonce or hash from this directive, or remove UNSAFE_INLINE`;

const UNSAFE_CASES: readonly { token: string; exportName: string; placeholder: CspSourceValue }[] = [
  { token: "'unsafe-inline'", exportName: "UNSAFE_INLINE", placeholder: UNSAFE_INLINE },
  { token: "'unsafe-eval'", exportName: "UNSAFE_EVAL", placeholder: UNSAFE_EVAL },
  { token: "'unsafe-hashes'", exportName: "UNSAFE_HASHES", placeholder: UNSAFE_HASHES },
  { token: "'wasm-unsafe-eval'", exportName: "WASM_UNSAFE_EVAL", placeholder: WASM_UNSAFE_EVAL },
];

const optOutSources = (placeholder: CspSourceValue): CspSourceValue[] =>
  placeholder === UNSAFE_INLINE ? ["'self'", placeholder] : ["'self'", NONCE, placeholder];

const D = applySecurityHeaders(new Response("ok"), { nonce: "abc" }).headers.get("content-security-policy") ?? "";

const D_RO = D.replace("; upgrade-insecure-requests", "");

const R = "https://r.example/csp";

const hardenedWith = (options: SecurityHeadersOptions) => applySecurityHeaders(new Response("ok"), { ...options, nonce: "abc" }).headers;

const nonceIn = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1] ?? "";

async function headersFor(middleware: ReturnType<typeof createSecurityHeaders>) {
  const app = new Forge();
  app.use("*", middleware);
  mapHandler(app, "GET", "/", () => new Response("ok"));
  const res = await app.request("/");
  return res.headers;
}

describe("createSecurityHeaders — defaults", () => {
  it("sets strict-transport-security with default max-age", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("sets content-security-policy", async () => {
    const headers = await headersFor(createSecurityHeaders());
    const csp = headers.get("content-security-policy");
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
  });

  it("includes a nonce in the CSP script-src", async () => {
    const headers = await headersFor(createSecurityHeaders());
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'nonce-");
  });

  it("sets referrer-policy", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets x-content-type-options", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not include any hashes or external origins by default", async () => {
    const headers = await headersFor(createSecurityHeaders());
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("sha256-");
    expect(csp).not.toContain("http");
  });

  it("sets cross-origin-opener-policy to same-origin by default", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("sets cross-origin-resource-policy to same-origin by default", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("does not set cross-origin-embedder-policy by default (opt-in only)", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("cross-origin-embedder-policy")).toBeNull();
  });
});

describe("createSecurityHeaders — custom options", () => {
  it("overrides the HSTS max-age, keeping both default tokens", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: { maxAge: 31536000 } }));
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("emits the default HSTS string for an empty hsts object", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: {} }));
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("treats an hsts field given as undefined as omitted, keeping its default", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: { maxAge: undefined, includeSubDomains: undefined, preload: undefined } }));
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("omits strict-transport-security when hsts is false", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: false }));
    expect(headers.get("strict-transport-security")).toBeNull();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("drops only includeSubDomains when that flag is false", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: { includeSubDomains: false } }));
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; preload");
  });

  it("drops only preload when that flag is false", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: { preload: false } }));
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
  });

  it("prints max-age alone when both flags are false", async () => {
    const headers = await headersFor(createSecurityHeaders({ hsts: { maxAge: 0, includeSubDomains: false, preload: false } }));
    expect(headers.get("strict-transport-security")).toBe("max-age=0");
  });

  for (const maxAge of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`rejects an HSTS maxAge of ${String(maxAge)} at factory time`, () => {
      expect(() => createSecurityHeaders({ hsts: { maxAge } })).toThrow(
        `Invalid HSTS maxAge ${String(maxAge)}: must be a non-negative integer number of seconds`,
      );
    });
  }

  it("overrides scriptSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ scriptSrc: ["'self'", "https://cdn.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("cdn.example.com");
  });

  it("overrides connectSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ connectSrc: ["'self'", "https://api.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("api.example.com");
  });

  it("overrides frameSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ frameSrc: ["'self'", "https://embed.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("embed.example.com");
  });

  it("overrides styleSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ styleSrc: ["'self'", "https://fonts.googleapis.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("style-src 'self' https://fonts.googleapis.com;");
  });

  it("overrides fontSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ fontSrc: ["'self'", "https://fonts.gstatic.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com;");
  });

  it("overrides cross-origin-opener-policy for popup flows", async () => {
    const headers = await headersFor(createSecurityHeaders({ crossOriginOpenerPolicy: "same-origin-allow-popups" }));
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
  });

  it("overrides cross-origin-resource-policy for embeddable resources", async () => {
    const headers = await headersFor(createSecurityHeaders({ crossOriginResourcePolicy: "cross-origin" }));
    expect(headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("emits cross-origin-embedder-policy only when opted in", async () => {
    const headers = await headersFor(createSecurityHeaders({ crossOriginEmbedderPolicy: "require-corp" }));
    expect(headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });
});

describe("createSecurityHeaders — directive validation", () => {
  it("throws when a custom directive contains an empty string", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", ""] })).toThrow();
  });

  it("throws on a whitespace-only connect-src entry", () => {
    expect(() => createSecurityHeaders({ connectSrc: ["   "] })).toThrow();
  });

  it("throws on an empty style-src entry", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["'self'", ""] })).toThrow();
  });

  it("throws on an empty font-src entry", () => {
    expect(() => createSecurityHeaders({ fontSrc: ["'self'", ""] })).toThrow();
  });

  it("names the directive and the non-empty rule for a whitespace-only entry", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["   "] })).toThrow(
      'Invalid CSP directive "styleSrc": source entries must be non-empty strings',
    );
  });

  it("rejects a source smuggling a second directive after a semicolon", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["'self'; script-src-elem 'unsafe-inline'"] })).toThrow(tokenMessage("styleSrc"));
  });

  it("rejects a scriptSrc source smuggling a second directive after a semicolon", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'; script-src-elem 'unsafe-inline'"] })).toThrow(tokenMessage("scriptSrc"));
  });

  it("rejects a source carrying an internal space", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["'self' 'unsafe-inline'"] })).toThrow(tokenMessage("styleSrc"));
  });

  it("rejects a source carrying a CRLF header break", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["'self'\r\nx-injected: 1"] })).toThrow(tokenMessage("styleSrc"));
  });

  it("rejects a source carrying a comma", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["https://a.example,https://b.example"] })).toThrow(tokenMessage("styleSrc"));
  });

  for (const { token, exportName } of UNSAFE_CASES) {
    it(`rejects the ${token} string spelling on scriptSrc, naming ${exportName}`, () => {
      expect(() => createSecurityHeaders({ scriptSrc: ["'self'", token] })).toThrow(unsafeMessage("scriptSrc", token, exportName));
    });
  }

  it("rejects 'unsafe-inline' spelled in upper case, reporting the lowercase token", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["'UNSAFE-INLINE'"] })).toThrow(unsafeMessage("styleSrc", "'unsafe-inline'", "UNSAFE_INLINE"));
  });

  it("rejects 'unsafe-eval' spelled in upper case, reporting the lowercase token", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'UNSAFE-EVAL'"] })).toThrow(unsafeMessage("scriptSrc", "'unsafe-eval'", "UNSAFE_EVAL"));
  });

  it("rejects 'unsafe-eval' on workerSrc, so the rule is not scriptSrc-only", () => {
    expect(() => createSecurityHeaders({ workerSrc: ["'self'", "'unsafe-eval'"] })).toThrow(
      unsafeMessage("workerSrc", "'unsafe-eval'", "UNSAFE_EVAL"),
    );
  });

  it("accepts the NONCE placeholder, which is not a string source", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", NONCE] })).not.toThrow();
  });

  for (const { token, placeholder } of UNSAFE_CASES) {
    it(`accepts the opt-out placeholder for ${token}`, () => {
      expect(() => createSecurityHeaders({ scriptSrc: optOutSources(placeholder) })).not.toThrow();
    });
  }

  it("rejects UNSAFE_INLINE beside the nonce placeholder", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", NONCE, UNSAFE_INLINE] })).toThrow(inertInlineMessage("scriptSrc"));
  });

  it("rejects UNSAFE_INLINE beside a hash source with no nonce present", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'sha256-abc='", UNSAFE_INLINE] })).toThrow(inertInlineMessage("scriptSrc"));
  });

  it("rejects the same pair through applySecurityHeaders", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { scriptSrc: ["'self'", NONCE, UNSAFE_INLINE] })).toThrow(
      inertInlineMessage("scriptSrc"),
    );
  });

  it("rejects a merged scriptSrc, because the merge backfills the nonce-bearing default", () => {
    expect(() => createSecurityHeaders(mergeSecurityHeaders({}, { scriptSrc: [UNSAFE_INLINE] }))).toThrow(inertInlineMessage("scriptSrc"));
  });

  it("accepts UNSAFE_INLINE on scriptSrc stated without a nonce", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", UNSAFE_INLINE] })).not.toThrow();
  });

  it("accepts UNSAFE_INLINE on styleSrc, whose default carries no nonce", () => {
    expect(() => createSecurityHeaders({ styleSrc: ["'self'", UNSAFE_INLINE] })).not.toThrow();
  });

  it("accepts UNSAFE_HASHES beside a nonce, which CSP does not ignore", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", NONCE, UNSAFE_HASHES] })).not.toThrow();
  });

  it("does not treat 'wasm-unsafe-eval' as a prefix match of 'unsafe-eval'", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", "'wasm-unsafe-eval'"] })).toThrow(
      unsafeMessage("scriptSrc", "'wasm-unsafe-eval'", "WASM_UNSAFE_EVAL"),
    );
  });
});

describe("createSecurityHeaders — unsafe-source opt-outs", () => {
  for (const { token, placeholder } of UNSAFE_CASES) {
    it(`renders ${token} into script-src from its placeholder`, async () => {
      const headers = await headersFor(createSecurityHeaders({ scriptSrc: optOutSources(placeholder) }));
      const csp = headers.get("content-security-policy") ?? "";
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
      const prefix = placeholder === UNSAFE_INLINE ? "script-src 'self'" : `script-src 'self' 'nonce-${nonce}'`;
      expect(csp).toContain(`${prefix} ${token};`);
    });

    it(`renders ${token} through applySecurityHeaders with a fixed nonce`, () => {
      const hardened = applySecurityHeaders(new Response("ok"), { scriptSrc: optOutSources(placeholder), nonce: "fixed" });
      const prefix = placeholder === UNSAFE_INLINE ? "script-src 'self'" : "script-src 'self' 'nonce-fixed'";
      expect(hardened.headers.get("content-security-policy")).toContain(`${prefix} ${token};`);
    });
  }

  it("renders an opt-out in a non-default directive too", async () => {
    const headers = await headersFor(createSecurityHeaders({ workerSrc: ["'self'", WASM_UNSAFE_EVAL] }));
    expect(headers.get("content-security-policy")).toContain("worker-src 'self' 'wasm-unsafe-eval'");
  });

  it("survives mergeSecurityHeaders and reaches the header", async () => {
    const merged = mergeSecurityHeaders({ scriptSrc: ["'self'", NONCE] }, { scriptSrc: [WASM_UNSAFE_EVAL] });
    const headers = await headersFor(createSecurityHeaders(merged));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'wasm-unsafe-eval'");
  });
});

describe("getNonce", () => {
  it("returns exactly the empty string when createSecurityHeaders did not run", async () => {
    let observed: string | undefined;
    const app = new Forge();
    mapHandler(app, "GET", "/", (context) => {
      observed = getNonce(context);
      return new Response("ok");
    });
    await app.request("/");
    expect(observed).toBe("");
  });

  it("is stable within a request and matches the CSP header", async () => {
    let observed = "";
    let observedAgain = "";
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", (context) => {
      observed = getNonce(context);
      observedAgain = getNonce(context);
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(observed).not.toBe("");
    expect(observed).toBe(observedAgain);
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${observed}'`);
  });

  it("differs across requests", async () => {
    const seen: string[] = [];
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", (context) => {
      seen.push(getNonce(context));
      return new Response("ok");
    });
    await app.request("/");
    await app.request("/");
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe("applySecurityHeaders", () => {
  it("embeds an explicit nonce and renders the exact default CSP", () => {
    const hardened = applySecurityHeaders(new Response("oops", { status: 500 }), { nonce: "test-nonce-abc" });
    expect(hardened.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self' 'nonce-test-nonce-abc'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'self'; object-src 'none'; base-uri 'self'; upgrade-insecure-requests",
    );
  });

  it("mints a fresh base64url nonce when options.nonce is omitted", () => {
    const hardened = applySecurityHeaders(new Response("ok"));
    const csp = hardened.headers.get("content-security-policy") ?? "";
    const match = csp.match(/'nonce-([A-Za-z0-9_-]{22})'/);
    expect(match).not.toBeNull();
  });

  it("mints distinct nonces across calls", () => {
    const extract = (r: Response) => (r.headers.get("content-security-policy") ?? "").match(/'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    const first = extract(applySecurityHeaders(new Response("a")));
    const second = extract(applySecurityHeaders(new Response("b")));
    expect(first).not.toBe(second);
  });

  it("combines header options with an explicit nonce", () => {
    const hardened = applySecurityHeaders(new Response("ok"), {
      scriptSrc: ["'self'", NONCE, "https://cdn.example.com"],
      hsts: { maxAge: 31536000 },
      nonce: "fixed",
    });
    const csp = hardened.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-fixed' https://cdn.example.com");
    expect(hardened.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("omits strict-transport-security when hsts is false", () => {
    expect(applySecurityHeaders(new Response("ok"), { hsts: false }).headers.get("strict-transport-security")).toBeNull();
  });

  it("rejects a negative HSTS maxAge", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { hsts: { maxAge: -1 } })).toThrow(
      "Invalid HSTS maxAge -1: must be a non-negative integer number of seconds",
    );
  });

  it("accepts a base64url nonce with padding", () => {
    const csp = applySecurityHeaders(new Response("ok"), { nonce: "ab+/_-cd==" }).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'nonce-ab+/_-cd=='");
  });

  it("rejects a nonce that would close the quoted source and append a directive source", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { nonce: "abc' 'unsafe-inline" })).toThrow(
      "Invalid CSP nonce: must be a non-empty base64 or base64url value (no quotes, whitespace or CSP separators)",
    );
  });

  it("rejects an empty nonce", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { nonce: "" })).toThrow("Invalid CSP nonce");
  });

  it("validates its directives at call time, not only at factory time", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { styleSrc: ["'self'; script-src-elem 'unsafe-inline'"], nonce: "n" })).toThrow(
      tokenMessage("styleSrc"),
    );
  });

  it("rejects 'unsafe-inline' passed straight to the response hardener", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { scriptSrc: ["'unsafe-inline'"], nonce: "n" })).toThrow(
      unsafeMessage("scriptSrc", "'unsafe-inline'", "UNSAFE_INLINE"),
    );
  });

  it("rejects 'unsafe-eval' passed straight to the response hardener", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { scriptSrc: ["'unsafe-eval'"], nonce: "n" })).toThrow(
      unsafeMessage("scriptSrc", "'unsafe-eval'", "UNSAFE_EVAL"),
    );
  });

  it("appends a response's own CSP after forge's instead of overwriting it", () => {
    const own = new Response("ok", { headers: { "content-security-policy": "sandbox" } });
    const hardened = applySecurityHeaders(own, { nonce: "abc" });
    expect(hardened.headers.get("content-security-policy")).toBe(`${D}, sandbox`);
  });

  it("preserves status, statusText, body, and pre-existing headers", async () => {
    const original = new Response("teapot body", { status: 418, statusText: "I'm a teapot", headers: { "x-custom": "kept" } });
    const hardened = applySecurityHeaders(original, { nonce: "n" });
    expect(hardened.status).toBe(418);
    expect(hardened.statusText).toBe("I'm a teapot");
    expect(hardened.headers.get("x-custom")).toBe("kept");
    expect(hardened.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await hardened.text()).toBe("teapot body");
  });
});

describe("createSecurityHeaders — permissions-policy", () => {
  it("defaults to fail-closed for all four features", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=()");
  });

  it("enables microphone with self keyword", async () => {
    const headers = await headersFor(createSecurityHeaders({ permissionsPolicy: { microphone: ["self"] } }));
    const policy = headers.get("permissions-policy") ?? "";
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
  });

  it("quotes non-keyword origins in the allowlist", async () => {
    const headers = await headersFor(createSecurityHeaders({ permissionsPolicy: { microphone: ["https://example.com"] } }));
    const policy = headers.get("permissions-policy") ?? "";
    expect(policy).toContain('microphone=("https://example.com")');
  });
});

describe("mergeSecurityHeaders — permissionsPolicy", () => {
  it("merges features independently, extra overrides base per-feature", () => {
    const base = { permissionsPolicy: { camera: ["self"] as string[] } };
    const merged = mergeSecurityHeaders(base, { permissionsPolicy: { microphone: ["self"] } });
    expect(merged.permissionsPolicy?.camera).toEqual(["self"]);
    expect(merged.permissionsPolicy?.microphone).toEqual(["self"]);
  });

  it("does not mutate base permissionsPolicy", () => {
    const base = { permissionsPolicy: { camera: ["self"] as string[] } };
    mergeSecurityHeaders(base, { permissionsPolicy: { camera: ["*"] } });
    expect(base.permissionsPolicy?.camera).toEqual(["self"]);
  });
});

describe("mergeSecurityHeaders", () => {
  it("concatenates sources onto a single directive", () => {
    const base = { scriptSrc: ["'self'"], connectSrc: ["'self'"] };
    const merged = mergeSecurityHeaders(base, { scriptSrc: ["'sha256-abc='"] });
    expect(merged.scriptSrc).toEqual(["'self'", "'sha256-abc='"]);
  });

  it("leaves untouched directives intact", () => {
    const base = { scriptSrc: ["'self'"], connectSrc: ["'self'", "https://api.example.com"] };
    const merged = mergeSecurityHeaders(base, { scriptSrc: ["'sha256-abc='"] });
    expect(merged.connectSrc).toEqual(["'self'", "https://api.example.com"]);
  });

  it("returns base unchanged for empty extra", () => {
    const base: SecurityHeadersOptions = { scriptSrc: ["'self'"], connectSrc: ["'self'"], hsts: { maxAge: 100 } };
    const merged = mergeSecurityHeaders(base, {});
    expect(merged).toEqual({ scriptSrc: ["'self'"], connectSrc: ["'self'"], hsts: { maxAge: 100 } });
  });

  it("does not mutate base", () => {
    const base = { scriptSrc: ["'self'"] };
    mergeSecurityHeaders(base, { scriptSrc: ["'sha256-abc='"] });
    expect(base.scriptSrc).toEqual(["'self'"]);
  });

  it("concatenates styleSrc and fontSrc onto a base list", () => {
    const base: SecurityHeadersOptions = { styleSrc: ["'self'"], fontSrc: ["'self'"] };
    const merged = mergeSecurityHeaders(base, { styleSrc: ["https://fonts.googleapis.com"], fontSrc: ["https://fonts.gstatic.com"] });
    expect(merged.styleSrc).toEqual(["'self'", "https://fonts.googleapis.com"]);
    expect(merged.fontSrc).toEqual(["'self'", "https://fonts.gstatic.com"]);
  });

  it("falls back to the styleSrc default when the base omits the directive", () => {
    expect(mergeSecurityHeaders({}, { styleSrc: ["https://cdn.example.com"] }).styleSrc).toEqual(["'self'", "https://cdn.example.com"]);
  });

  it("retains 'self' and the nonce placeholder when the base omits scriptSrc", () => {
    expect(mergeSecurityHeaders({}, { scriptSrc: ["https://cdn.example.com"] }).scriptSrc).toEqual(["'self'", NONCE, "https://cdn.example.com"]);
  });

  it("keeps workerSrc default-free, emitting exactly the extra sources", () => {
    expect(mergeSecurityHeaders({}, { workerSrc: ["blob:"] }).workerSrc).toEqual(["blob:"]);
  });

  it("keeps childSrc default-free, emitting exactly the extra sources", () => {
    expect(mergeSecurityHeaders({}, { childSrc: ["https://embed.example.com"] }).childSrc).toEqual(["https://embed.example.com"]);
  });

  it("falls back to the imgSrc default, which carries two sources", () => {
    expect(mergeSecurityHeaders({}, { imgSrc: ["https://images.example.com"] }).imgSrc).toEqual(["'self'", "data:", "https://images.example.com"]);
  });

  it("merges an hsts object onto a base hsts object field by field", () => {
    const base: SecurityHeadersOptions = { hsts: { maxAge: 100, preload: false } };
    expect(mergeSecurityHeaders(base, { hsts: { maxAge: 200 } }).hsts).toEqual({ maxAge: 200, preload: false });
  });

  it("keeps a base hsts field the extra gives as undefined", () => {
    const base: SecurityHeadersOptions = { hsts: { maxAge: 100, preload: false } };
    expect(mergeSecurityHeaders(base, { hsts: { maxAge: undefined, preload: undefined } }).hsts).toEqual({ maxAge: 100, preload: false });
  });

  it("leaves the base hsts object untouched when merging onto it", () => {
    const base: SecurityHeadersOptions = { hsts: { maxAge: 100 } };
    mergeSecurityHeaders(base, { hsts: { preload: false } });
    expect(base.hsts).toEqual({ maxAge: 100 });
  });

  it("lets an extra hsts false replace a base hsts object", () => {
    expect(mergeSecurityHeaders({ hsts: { maxAge: 100 } }, { hsts: false }).hsts).toBe(false);
  });

  it("lets an extra hsts object replace a base hsts false", () => {
    expect(mergeSecurityHeaders({ hsts: false }, { hsts: { preload: false } }).hsts).toEqual({ preload: false });
  });

  it("keeps a base hsts false when the extra omits hsts", () => {
    expect(mergeSecurityHeaders({ hsts: false }, {}).hsts).toBe(false);
  });

  it("overrides cross-origin policies when provided, preserving unset ones", () => {
    const base: SecurityHeadersOptions = { crossOriginOpenerPolicy: "same-origin" };
    const merged = mergeSecurityHeaders(base, { crossOriginOpenerPolicy: "same-origin-allow-popups", crossOriginEmbedderPolicy: "credentialless" });
    expect(merged.crossOriginOpenerPolicy).toBe("same-origin-allow-popups");
    expect(merged.crossOriginEmbedderPolicy).toBe("credentialless");
    expect(merged.crossOriginResourcePolicy).toBeUndefined();
  });
});

describe("createSecurityHeaders — pending-header precedence", () => {
  it("lets a middleware registered deeper win an overlapping header name", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    app.use("*", (context, next) => {
      setPendingHeader(context, "referrer-policy", "unsafe-url");
      return next();
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");

    expect(res.headers.get("referrer-policy")).toBe("unsafe-url");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("still wins over a header the route handler set on the Response itself", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", () => new Response("ok", { headers: { "referrer-policy": "unsafe-url" } }));

    const res = await app.request("/");

    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("combines a CSP the route handler set with the app's, so the handler's can only tighten it", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", () => new Response("ok", { headers: { "content-security-policy": "sandbox" } }));

    const res = await app.request("/");

    const policies = (res.headers.get("content-security-policy") ?? "").split(", ");
    expect(policies).toHaveLength(2);
    expect(policies[0]).toStartWith("default-src 'self'");
    expect(policies[1]).toBe("sandbox");
  });

  it("reaches the error page when a guard registered deeper throws", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    app.use("*", () => {
      throw new Error("guard exploded");
    });
    mapHandler(app, "GET", "/", () => new Response("unreached"));

    const res = await app.request("/");

    expect(res.status).toBe(500);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });
});

describe("createSecurityHeaders — precomputed headers", () => {
  it("differs between two requests only in the nonce", async () => {
    const middleware = createSecurityHeaders();
    const first = await headersFor(middleware);
    const second = await headersFor(middleware);

    const firstCsp = first.get("content-security-policy") ?? "";
    const secondCsp = second.get("content-security-policy") ?? "";
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
    expect(nonceOf(firstCsp)).not.toBe("");
    expect(nonceOf(firstCsp)).not.toBe(nonceOf(secondCsp));
    expect(firstCsp.replaceAll(nonceOf(firstCsp), "N")).toBe(secondCsp.replaceAll(nonceOf(secondCsp), "N"));

    for (const name of [
      "strict-transport-security",
      "referrer-policy",
      "x-content-type-options",
      "permissions-policy",
      "x-frame-options",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
    ]) {
      expect(first.get(name)).toBe(second.get(name));
    }
  });

  it("refuses a source containing NUL, so the nonce placeholder is unreachable", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", "https://cdn.example\u0000"] })).toThrow(tokenMessage("scriptSrc"));
  });

  it("renders a CSP containing no NUL", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("content-security-policy")?.includes("\u0000")).toBe(false);
  });
});

describe("createSecurityHeaders — Trusted Types", () => {
  it("emits require-trusted-types-for and the policy names", () => {
    expect(hardenedWith({ trustedTypes: { policies: ["forge", "dompurify"] } }).get("content-security-policy")).toBe(
      `${D}; require-trusted-types-for 'script'; trusted-types forge dompurify`,
    );
  });

  it("appends 'allow-duplicates' when asked", () => {
    expect(hardenedWith({ trustedTypes: { policies: ["forge"], allowDuplicates: true } }).get("content-security-policy")).toBe(
      `${D}; require-trusted-types-for 'script'; trusted-types forge 'allow-duplicates'`,
    );
  });

  it("omits require-trusted-types-for when require is false", () => {
    expect(hardenedWith({ trustedTypes: { policies: ["forge"], require: false } }).get("content-security-policy")).toBe(
      `${D}; trusted-types forge`,
    );
  });

  it("renders an empty policy list as 'none'", () => {
    expect(hardenedWith({ trustedTypes: { policies: [] } }).get("content-security-policy")).toBe(
      `${D}; require-trusted-types-for 'script'; trusted-types 'none'`,
    );
  });

  it("reaches the response through the middleware", async () => {
    const headers = await headersFor(createSecurityHeaders({ trustedTypes: { policies: ["forge"] } }));
    expect(headers.get("content-security-policy")).toEndWith("; require-trusted-types-for 'script'; trusted-types forge");
  });
});

describe("createSecurityHeaders — Trusted Types and reporting validation", () => {
  for (const name of ["my policy", "*", "'none'", "a;script-src"]) {
    it(`rejects the policy name ${JSON.stringify(name)}`, () => {
      expect(() => createSecurityHeaders({ trustedTypes: { policies: [name] } })).toThrow(
        `Invalid Trusted Types policy name ${JSON.stringify(name)}: must be one or more of A-Z a-z 0-9 - # = _ / @ . %`,
      );
    });
  }

  it("accepts a policy name drawing on every permitted character class", () => {
    expect(() => createSecurityHeaders({ trustedTypes: { policies: ["a-Z0_9#=/@.%"] } })).not.toThrow();
  });

  it("rejects allowDuplicates with no policy names", () => {
    expect(() => createSecurityHeaders({ trustedTypes: { policies: [], allowDuplicates: true } })).toThrow(
      "Invalid trustedTypes: allowDuplicates needs at least one policy name",
    );
  });

  const BAD_ENDPOINTS = [
    "http://r.example/csp",
    "/csp",
    "https://r.example/a,b",
    "https://r.example/a;b",
    'https://r.example/a"b',
    "https://r.example/a\\b",
    "https://r.example/a b",
  ];
  for (const endpoint of BAD_ENDPOINTS) {
    it(`rejects the reporting endpoint ${JSON.stringify(endpoint)}`, () => {
      expect(() => createSecurityHeaders({ reporting: { endpoint } })).toThrow(
        `Invalid CSP reporting endpoint ${JSON.stringify(endpoint)}: must be an absolute https URL with no whitespace, ';', ',', '"' or '\\'`,
      );
    });
  }

  for (const group of ["CSP", "1csp", "csp endpoint"]) {
    it(`rejects the reporting group ${JSON.stringify(group)}`, () => {
      expect(() => createSecurityHeaders({ reporting: { endpoint: R, group } })).toThrow(
        `Invalid CSP reporting group ${JSON.stringify(group)}: must be a lowercase letter followed by lowercase letters, digits, '_' or '-'`,
      );
    });
  }

  it("rejects an unsafe string source in reportOnly, naming the reportOnly directive", () => {
    expect(() => createSecurityHeaders({ reportOnly: { scriptSrc: ["'self'", "'unsafe-eval'"] } })).toThrow(
      unsafeMessage("reportOnly.scriptSrc", "'unsafe-eval'", "UNSAFE_EVAL"),
    );
  });

  it("rejects UNSAFE_INLINE beside a nonce in reportOnly", () => {
    expect(() => createSecurityHeaders({ reportOnly: { scriptSrc: ["'self'", NONCE, UNSAFE_INLINE] } })).toThrow(
      inertInlineMessage("reportOnly.scriptSrc"),
    );
  });

  it("validates Trusted Types and reporting on every applySecurityHeaders call", () => {
    expect(() => applySecurityHeaders(new Response("ok"), { trustedTypes: { policies: ["*"] } })).toThrow("Invalid Trusted Types policy name");
    expect(() => applySecurityHeaders(new Response("ok"), { reporting: { endpoint: "/csp" } })).toThrow("Invalid CSP reporting endpoint");
  });
});

describe("createSecurityHeaders — reporting", () => {
  it("appends report-uri and report-to to the CSP", () => {
    expect(hardenedWith({ reporting: { endpoint: R } }).get("content-security-policy")).toBe(`${D}; report-uri ${R}; report-to csp-endpoint`);
  });

  it("names the endpoint in Reporting-Endpoints under the default group", () => {
    expect(hardenedWith({ reporting: { endpoint: R } }).get("reporting-endpoints")).toBe(`csp-endpoint="${R}"`);
  });

  it("uses a stated group in both headers", () => {
    const headers = hardenedWith({ reporting: { endpoint: R, group: "notes-csp" } });
    expect(headers.get("content-security-policy")).toBe(`${D}; report-uri ${R}; report-to notes-csp`);
    expect(headers.get("reporting-endpoints")).toBe(`notes-csp="${R}"`);
  });

  it("emits neither the header nor the directives without reporting", () => {
    const headers = hardenedWith({});
    expect(headers.get("reporting-endpoints")).toBeNull();
    expect(headers.get("content-security-policy")).toBe(D);
  });
});

describe("createSecurityHeaders — Report-Only", () => {
  it("emits no Report-Only header by default", () => {
    expect(hardenedWith({}).get("content-security-policy-report-only")).toBeNull();
  });

  it("builds the Report-Only policy from the enforced one plus the stated fields", () => {
    const headers = hardenedWith({ reportOnly: { trustedTypes: { policies: ["forge"] } } });
    expect(headers.get("content-security-policy-report-only")).toBe(`${D_RO}; require-trusted-types-for 'script'; trusted-types forge`);
    expect(headers.get("content-security-policy")).toBe(D);
  });

  it("never carries upgrade-insecure-requests, which browsers ignore in Report-Only", () => {
    const headers = hardenedWith({ reportOnly: { connectSrc: ["'self'"] } });
    expect(headers.get("content-security-policy-report-only")).not.toContain("upgrade-insecure-requests");
  });

  it("shares the request's nonce with the enforced policy", async () => {
    let observed = "";
    const app = new Forge();
    app.use("*", createSecurityHeaders({ reportOnly: { trustedTypes: { policies: ["forge"] } } }));
    mapHandler(app, "GET", "/", (context) => {
      observed = getNonce(context);
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(observed).not.toBe("");
    expect(nonceIn(res.headers.get("content-security-policy"))).toBe(observed);
    expect(nonceIn(res.headers.get("content-security-policy-report-only"))).toBe(observed);
  });

  it("replaces a stated field and inherits an unstated one", () => {
    const headers = hardenedWith({
      scriptSrc: ["'self'", NONCE, TURNSTILE_CSP],
      connectSrc: ["'self'", "https://api.example"],
      reportOnly: { scriptSrc: ["'self'", NONCE] },
    });
    const enforced = headers.get("content-security-policy") ?? "";
    const reportOnly = headers.get("content-security-policy-report-only") ?? "";
    expect(enforced).toContain(`script-src 'self' 'nonce-abc' ${TURNSTILE_CSP};`);
    expect(reportOnly).toContain("script-src 'self' 'nonce-abc';");
    expect(reportOnly).not.toContain(TURNSTILE_CSP);
    expect(reportOnly).toContain("connect-src 'self' https://api.example;");
  });

  it("reports the Report-Only policy's violations to the same endpoint", () => {
    const headers = hardenedWith({ reporting: { endpoint: R }, reportOnly: { connectSrc: ["'self'"] } });
    expect(headers.get("content-security-policy-report-only")).toBe(`${D_RO}; report-uri ${R}; report-to csp-endpoint`);
  });
});

describe("mergeSecurityHeaders — CSP family", () => {
  it("concatenates Trusted Types policies, letting the extra's stated flags win", () => {
    const merged = mergeSecurityHeaders(
      { trustedTypes: { policies: ["forge"], allowDuplicates: false, require: false } },
      { trustedTypes: { policies: ["dompurify"], allowDuplicates: true } },
    );
    expect(merged.trustedTypes).toEqual({ policies: ["forge", "dompurify"], allowDuplicates: true, require: false });
  });

  it("takes the extra's Trusted Types when the base has none", () => {
    expect(mergeSecurityHeaders({}, { trustedTypes: { policies: ["forge"] } }).trustedTypes).toEqual({ policies: ["forge"] });
  });

  it("replaces reporting", () => {
    const merged = mergeSecurityHeaders({ reporting: { endpoint: R, group: "old" } }, { reporting: { endpoint: "https://s.example/csp" } });
    expect(merged.reporting).toEqual({ endpoint: "https://s.example/csp" });
  });

  it("concatenates a Report-Only directive onto the base's Report-Only list", () => {
    const merged = mergeSecurityHeaders({ reportOnly: { connectSrc: ["'self'"] } }, { reportOnly: { connectSrc: ["https://beta.example"] } });
    expect(merged.reportOnly?.connectSrc).toEqual(["'self'", "https://beta.example"]);
  });

  it("backfills a Report-Only directive the base never stated from the merged enforced list", () => {
    const merged = mergeSecurityHeaders(
      { connectSrc: ["'self'"] },
      { connectSrc: ["https://api.example"], reportOnly: { connectSrc: ["https://beta.example"] } },
    );
    expect(merged.reportOnly?.connectSrc).toEqual(["'self'", "https://api.example", "https://beta.example"]);
  });

  it("keeps the base's Report-Only options when the extra states none", () => {
    const base: SecurityHeadersOptions = { reportOnly: { scriptSrc: ["'self'", NONCE] } };
    expect(mergeSecurityHeaders(base, { connectSrc: ["https://api.example"] }).reportOnly).toEqual({ scriptSrc: ["'self'", NONCE] });
  });

  it("leaves the base's Trusted Types policies untouched", () => {
    const base: SecurityHeadersOptions = { trustedTypes: { policies: ["forge"] } };
    mergeSecurityHeaders(base, { trustedTypes: { policies: ["dompurify"] } });
    expect(base.trustedTypes?.policies).toEqual(["forge"]);
  });
});

describe("createRouteSecurityHeaders", () => {
  async function routeHeaders(path: string, extra: CspOptions, base?: SecurityHeadersOptions) {
    let nonce = "";
    let error: Error | undefined;
    const app = new Forge();
    app.setOnError((err) => {
      error = err;
      return new Response("error", { status: 500 });
    });
    app.use("*", createSecurityHeaders(base));
    app.use("/workers/*", createRouteSecurityHeaders(extra));
    const handler = (context: Parameters<typeof getNonce>[0]) => {
      nonce = getNonce(context);
      return new Response("ok");
    };
    mapHandler(app, "GET", "/", handler);
    mapHandler(app, "GET", "/workers/x.js", handler);
    const res = await app.request(path);
    return { res, nonce, error };
  }

  it("adds the extra sources on its route only", async () => {
    const worker = await routeHeaders("/workers/x.js", { scriptSrc: [WASM_UNSAFE_EVAL] });
    expect(worker.res.headers.get("content-security-policy")).toContain(`script-src 'self' 'nonce-${worker.nonce}' 'wasm-unsafe-eval';`);
    const page = await routeHeaders("/", { scriptSrc: [WASM_UNSAFE_EVAL] });
    expect(page.res.headers.get("content-security-policy")).not.toContain("wasm-unsafe-eval");
  });

  it("renders the request's own nonce", async () => {
    const { res, nonce } = await routeHeaders("/workers/x.js", { scriptSrc: [WASM_UNSAFE_EVAL] });
    expect(nonce).not.toBe("");
    expect(nonceIn(res.headers.get("content-security-policy"))).toBe(nonce);
  });

  it("merges over the app's options rather than the defaults", async () => {
    const { res, nonce } = await routeHeaders("/workers/x.js", { scriptSrc: [WASM_UNSAFE_EVAL] }, { scriptSrc: ["'self'", NONCE, TURNSTILE_CSP] });
    expect(res.headers.get("content-security-policy")).toContain(`script-src 'self' 'nonce-${nonce}' ${TURNSTILE_CSP} 'wasm-unsafe-eval';`);
  });

  it("re-queues the Report-Only policy, inheriting the merged enforced list", async () => {
    const { res, nonce } = await routeHeaders(
      "/workers/x.js",
      { scriptSrc: [WASM_UNSAFE_EVAL] },
      { reportOnly: { trustedTypes: { policies: ["forge"] } } },
    );
    const reportOnly = res.headers.get("content-security-policy-report-only") ?? "";
    expect(reportOnly).toContain(`script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval';`);
    expect(reportOnly).toEndWith("; trusted-types forge");
  });

  it("rejects an unsafe string source at construction", () => {
    expect(() => createRouteSecurityHeaders({ scriptSrc: ["'wasm-unsafe-eval'"] })).toThrow(
      unsafeMessage("scriptSrc", "'wasm-unsafe-eval'", "WASM_UNSAFE_EVAL"),
    );
  });

  it("fails the request when createSecurityHeaders has not run before it", async () => {
    let error: Error | undefined;
    const app = new Forge();
    app.setOnError((err) => {
      error = err;
      return new Response("error", { status: 500 });
    });
    app.use("*", createRouteSecurityHeaders({ scriptSrc: [WASM_UNSAFE_EVAL] }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");

    expect(res.status).toBe(500);
    expect(error?.message).toBe("createRouteSecurityHeaders: createSecurityHeaders must run earlier on this request");
  });

  it("fails the request when the merge produces an invalid policy", async () => {
    const { res, error } = await routeHeaders("/workers/x.js", { scriptSrc: [UNSAFE_INLINE] });
    expect(res.status).toBe(500);
    expect(error?.message).toBe(inertInlineMessage("scriptSrc"));
  });
});
