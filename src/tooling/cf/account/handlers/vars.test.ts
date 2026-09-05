import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CfPagesProject } from "../../api/types";
import type { WranglerConfig } from "../../types";
import type { HandlerContext } from "./types";
import { createVarsHandler } from "./vars";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: AUTH,
    scriptName: "worker",
    prefix: "",
    dryRun: false,
    rotate: new Set<string>(),
    fetch: globalThis.fetch,
    target: { kind: "worker", name: "worker" },
    ...overrides,
  };
}

function makePagesCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return makeCtx({ scriptName: "cornellaw", target: { kind: "pages", name: "cornellaw" }, ...overrides });
}

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }));
}

function cfError(code: number, message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, errors: [{ code, message }], messages: [], result: null }), { status });
}

/** Worker settings stub. */
function makeFetch(remoteBindings: unknown[], patchOk = true): typeof globalThis.fetch {
  return async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      if (!(init?.body instanceof FormData)) throw new Error("PATCH must use FormData body");
      if (!patchOk) return cfError(1, "patch failed", 400);
      return ok({});
    }
    return ok({ bindings: remoteBindings });
  };
}

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

/** Pages project stub that records the write it received. */
function makePagesFetch(project: CfPagesProject, captured: Captured[], patchOk = true): typeof globalThis.fetch {
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      captured.push({ url: String(url), method, body: JSON.parse(String(init?.body)) });
      if (!patchOk) return cfError(1, "patch failed", 400);
      return ok({});
    }
    captured.push({ url: String(url), method, body: undefined });
    return ok(project);
  };
}

type EnvVars = Record<string, { type: "plain_text" | "secret_text"; value?: string }>;

const pagesProject = (envVars: EnvVars): CfPagesProject => ({
  name: "cornellaw",
  deployment_configs: { production: { env_vars: envVars, wrangler_config_hash: "hash-1" } },
});

// `.dev.vars` is gitignored repo-wide, so fixtures are built in a temp tree at
// runtime rather than committed.
function makeProject(devVars: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "foundry-vars-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(configPath, `{ "name": "proj" }`, "utf-8");
  if (devVars !== null) writeFileSync(join(dir, ".dev.vars"), devVars, "utf-8");
  return configPath;
}

/** The common case: a project with no `.dev.vars`, so nothing is overridden. */
const handler = createVarsHandler(makeProject(null));

describe("varsHandler.extract()", () => {
  it("returns empty when no vars", () => {
    expect(handler.extract({ name: "t" } as WranglerConfig)).toEqual([]);
  });

  it("converts vars object to entries", () => {
    const config: WranglerConfig = { name: "t", vars: { EMAIL: "x@y.com", DEBUG: "true" } };
    const entries = handler.extract(config);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === "EMAIL")?.value).toBe("x@y.com");
  });

  it("reports no override when the project has no .dev.vars", () => {
    const entries = handler.extract({ name: "t", vars: { EMAIL: "x@y.com" } });
    expect(entries.map((e) => e.overridden)).toEqual([false]);
  });

  it("marks only the names .dev.vars also defines", () => {
    const shadowing = createVarsHandler(makeProject("BASE_URL=http://localhost:8787\nCSRF_SECRET=v\n"));
    const entries = shadowing.extract({ name: "t", vars: { BASE_URL: "https://prod.test", EMAIL_TO: "a@b.test" } });
    expect(entries.map((e) => [e.name, e.overridden])).toEqual([
      ["BASE_URL", true],
      ["EMAIL_TO", false],
    ]);
  });
});

describe("varsHandler — the override annotation", () => {
  const overridden = [{ name: "BASE_URL", value: "https://prod.test", overridden: true }];

  it("annotates a var whose value matches remotely", async () => {
    const fetchFn = makeFetch([{ type: "plain_text", name: "BASE_URL", text: "https://prod.test" }]);
    const res = await handler.reconcile(overridden, makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.detail).toBe(".dev.vars overrides locally");
  });

  it("annotates a var that is absent remotely", async () => {
    const res = await handler.reconcile(overridden, makeCtx({ fetch: makeFetch([]) }));
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect(res.results[0]?.detail).toBe(".dev.vars overrides locally");
  });

  it("annotates a var that has drifted", async () => {
    const fetchFn = makeFetch([{ type: "plain_text", name: "BASE_URL", text: "https://old.test" }]);
    const res = await handler.reconcile(overridden, makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.detail).toBe('"https://old.test" → "https://prod.test"; .dev.vars overrides locally');
  });

  it("says nothing extra when the name is not shadowed", async () => {
    const fetchFn = makeFetch([{ type: "plain_text", name: "BASE_URL", text: "https://prod.test" }]);
    const res = await handler.reconcile([{ name: "BASE_URL", value: "https://prod.test", overridden: false }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.detail).toBe("");
  });
});

describe("varsHandler.reconcile() — worker script", () => {
  it("reports exists when the value matches remotely", async () => {
    const fetchFn = makeFetch([{ type: "plain_text", name: "EMAIL", text: "x@y.com" }]);
    const res = await handler.reconcile([{ name: "EMAIL", value: "x@y.com", overridden: false }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.detail).toBe("");
  });

  it("reports a var absent remotely as pending the next deploy", async () => {
    const res = await handler.reconcile([{ name: "NEW_VAR", value: "val", overridden: false }], makeCtx({ fetch: makeFetch([]) }));
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
  });

  it("reports drift with both values, and leaves the push to the deploy", async () => {
    const fetchFn = makeFetch([{ type: "plain_text", name: "BASE_URL", text: "https://old.test" }]);
    const res = await handler.reconcile([{ name: "BASE_URL", value: "https://new.test", overridden: false }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("drift");
    expect(res.results[0]?.detail).toBe('"https://old.test" → "https://new.test"');
  });

  it("abbreviates a value too long for a table cell", async () => {
    const long = "x".repeat(60);
    const fetchFn = makeFetch([{ type: "plain_text", name: "BLOB", text: "old" }]);
    const res = await handler.reconcile([{ name: "BLOB", value: long, overridden: false }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.detail).toContain(`${"x".repeat(40)}…`);
    expect(res.results[0]?.detail).not.toContain("x".repeat(41));
  });

  it("issues no write at all, with or without --commit", async () => {
    // A var is pushed by `wrangler deploy`, which rewrites bindings from the config, so writing
    // one here would be undone — the assertion is on requests, not on rows.
    const methods: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (_url, init) => {
      methods.push((init?.method ?? "GET").toUpperCase());
      return ok({ bindings: [{ type: "plain_text", name: "DRIFTED", text: "old" }] });
    };

    const entries = [
      { name: "DRIFTED", value: "new", overridden: false },
      { name: "ABSENT", value: "v", overridden: false },
    ];
    await handler.reconcile(entries, makeCtx({ fetch: fetchFn, dryRun: false }));
    await handler.reconcile(entries, makeCtx({ fetch: fetchFn, dryRun: true }));

    expect(methods).toEqual(["GET", "GET"]);
  });
});

describe("varsHandler.reconcile() — pages project", () => {
  it("reads plain_text entries from deployment_configs.production", async () => {
    const captured: Captured[] = [];
    const fetchFn = makePagesFetch(pagesProject({ BASE_URL: { type: "plain_text", value: "https://x.test" } }), captured);

    const res = await handler.reconcile([{ name: "BASE_URL", value: "https://x.test", overridden: false }], makePagesCtx({ fetch: fetchFn }));

    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.detail).toBe("");
    expect(captured[0]?.url).toContain("/accounts/acc/pages/projects/cornellaw");
    expect(captured[0]?.url).not.toContain("/workers/scripts");
  });

  it("does not treat a secret_text entry as a var", async () => {
    const captured: Captured[] = [];
    const fetchFn = makePagesFetch(pagesProject({ CSRF_SECRET: { type: "secret_text" } }), captured);
    const res = await handler.reconcile([{ name: "CSRF_SECRET", value: "v", overridden: false }], makePagesCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("deploy-pushes");
  });

  it("issues no PATCH against the project", async () => {
    const captured: Captured[] = [];
    const fetchFn = makePagesFetch(pagesProject({ DRIFTED: { type: "plain_text", value: "old" } }), captured);

    await handler.reconcile([{ name: "DRIFTED", value: "new", overridden: false }], makePagesCtx({ fetch: fetchFn }));

    expect(captured.map((c) => c.method)).toEqual(["GET"]);
  });
});

describe("varsHandler.reconcile() — a missing target is not an auth failure", () => {
  const entries = [{ name: "V", value: "v", overridden: false }];

  it("reports a missing pages project as unavailable, naming it", async () => {
    const notFound: typeof globalThis.fetch = async () => cfError(7003, "Could not route", 404);
    const res = await handler.reconcile(entries, makePagesCtx({ fetch: notFound }));
    expect(res.results[0]?.action).toBe("unavailable");
    expect(res.results[0]?.detail).toBe("pages project · pages project not found: cornellaw");
  });

  it("reports a rejected token as an error", async () => {
    // Note the HTTP 400: Cloudflare does not use 401/403 here, which is why the
    // envelope's error code is what classification keys off.
    const badAuth: typeof globalThis.fetch = async () => cfError(9106, "Authentication failed", 400);
    const res = await handler.reconcile(entries, makePagesCtx({ fetch: badAuth }));
    expect(res.results[0]?.action).toBe("error");
    expect(res.results[0]?.detail).toBe(
      'pages project · auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Cloudflare Pages" (Read to report, Edit to change) · code 9106',
    );
  });

  it("distinguishes the two in action, not merely in prose", async () => {
    const notFound: typeof globalThis.fetch = async () => cfError(7003, "Could not route", 404);
    const badAuth: typeof globalThis.fetch = async () => cfError(9106, "Authentication failed", 400);

    const missing = await handler.reconcile(entries, makePagesCtx({ fetch: notFound }));
    const auth = await handler.reconcile(entries, makePagesCtx({ fetch: badAuth }));
    expect(missing.results[0]?.action).not.toBe(auth.results[0]?.action);
  });

  it("applies the same distinction on the worker branch", async () => {
    const notFound: typeof globalThis.fetch = async () => cfError(7003, "Could not route", 404);
    const res = await handler.reconcile(entries, makeCtx({ fetch: notFound }));
    expect(res.results[0]?.action).toBe("unavailable");
    expect(res.results[0]?.detail).toBe("worker script · worker script not found: worker");
  });
});

describe("varsHandler — a plain-text var only the remote knows about", () => {
  it("is reported, because the next deploy silently removes it", async () => {
    const fetchFn = makeFetch([
      { type: "plain_text", name: "DECLARED", text: "v" },
      { type: "plain_text", name: "LEGACY_FLAG", text: "on" },
    ]);
    const res = await handler.reconcile([{ name: "DECLARED", value: "v", overridden: false }], makeCtx({ fetch: fetchFn }));

    const orphan = res.results.find((r) => r.binding === "LEGACY_FLAG");
    expect(orphan?.action).toBe("remote-only");
    expect([orphan?.local, orphan?.remote]).toEqual([false, true]);
    expect(orphan?.detail).toBe("not declared in wrangler.jsonc — the next deploy removes it");
  });

  it("is found even when the config declares no vars at all", async () => {
    // Which is why this handler opts into reportsEmpty: an empty `vars` block is
    // exactly the case where every remote var is about to be dropped.
    expect(handler.reportsEmpty).toBe(true);
    const res = await handler.reconcile([], makeCtx({ fetch: makeFetch([{ type: "plain_text", name: "LEGACY_FLAG", text: "on" }]) }));
    expect(res.results.map((r) => r.binding)).toEqual(["LEGACY_FLAG"]);
  });

  it("does not mistake a remote secret for an orphaned var", async () => {
    const captured: Captured[] = [];
    const fetchFn = makePagesFetch(pagesProject({ A_SECRET: { type: "secret_text" } }), captured);
    const res = await handler.reconcile([], makePagesCtx({ fetch: fetchFn }));
    expect(res.results).toEqual([]);
  });
});
