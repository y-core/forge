import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBindings } from "../engine";
import type { WranglerConfig } from "../types";
import { GENERATE_MARKER, PUSH_MARKER } from "./devvars";
import { createRotatableSecretsHandler, createSecretsHandler } from "./secrets";
import type { HandlerContext } from "./types";

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

function makeFetch(secrets: unknown[], putOk = true): typeof globalThis.fetch {
  return async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      if (!putOk)
        return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "put failed" }], messages: [], result: null }), {
          status: 400,
        });
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { name: "secret", type: "secret_text" } }));
    }
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: secrets }));
  };
}

const remote = (...names: string[]) => names.map((name) => ({ name, type: "secret_text" }));

// `.dev.vars` is gitignored repo-wide, so fixtures are built in a temp tree at
// runtime rather than committed.
function makeProject(devVars: string | null, { subdir = false } = {}): { configPath: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "foundry-secrets-"));
  const dir = subdir ? join(root, "nested", "deep") : root;
  if (subdir) mkdirSync(dir, { recursive: true });
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(configPath, `{ "name": "proj" }`, "utf-8");
  if (devVars !== null) writeFileSync(join(dir, ".dev.vars"), devVars, "utf-8");
  return { configPath, dir };
}

/** A `.dev.vars` in which every named key is a fixed secret. */
const fixed = (...names: string[]) =>
  names
    .map((n) => `${PUSH_MARKER}\n${n}=v`)
    .join("\n")
    .concat("\n");

describe("createSecretsHandler() — .dev.vars discovery", () => {
  it("finds .dev.vars beside the config, not in the parent directory", () => {
    const { configPath } = makeProject(fixed("A", "B"));
    const entries = createSecretsHandler(configPath).extract({} as WranglerConfig);
    expect(entries.map((e) => e.name).sort()).toEqual(["A", "B"]);
  });

  it("finds .dev.vars when the config lives in a subdirectory", () => {
    const { configPath } = makeProject(fixed("NESTED_SECRET"), { subdir: true });
    const entries = createSecretsHandler(configPath).extract({} as WranglerConfig);
    expect(entries.map((e) => e.name)).toEqual(["NESTED_SECRET"]);
  });

  it("does not read a .dev.vars belonging to the parent directory", () => {
    const { configPath, dir } = makeProject(null, { subdir: true });
    // Plant one two levels up — the directory the old `resolve(configPath, "..")`
    // logic would have reached.
    writeFileSync(join(dir, "..", ".dev.vars"), fixed("WRONG"), "utf-8");
    const entries = createSecretsHandler(configPath).extract({} as WranglerConfig);
    expect(entries).toEqual([]);
  });

  it("returns empty when no .dev.vars exists", () => {
    const { configPath } = makeProject(null);
    expect(createSecretsHandler(configPath).extract({} as WranglerConfig)).toEqual([]);
  });
});

describe("createSecretsHandler() — absence is visible", () => {
  it("notes the path, without inventing a row, when .dev.vars is absent", async () => {
    // A note rather than a row: there is no binding here, and the row this used to
    // be had to invent a name, an action and a remote state to fill its columns.
    const { configPath, dir } = makeProject(null);
    const res = await createSecretsHandler(configPath).reconcile([], makeCtx({ fetch: makeFetch([]) }));
    expect(res.results).toEqual([]);
    expect(res.notes).toEqual([`No .dev.vars at ${join(dir, ".dev.vars")}.`]);
  });

  it("notes the path when .dev.vars exists but defines no keys", async () => {
    const { configPath, dir } = makeProject("# just a comment\n\n");
    const res = await createSecretsHandler(configPath).reconcile([], makeCtx({ fetch: makeFetch([]) }));
    expect(res.results).toEqual([]);
    expect(res.notes).toEqual([`.dev.vars at ${join(dir, ".dev.vars")} defines no keys.`]);
  });

  it("makes no request at all when the file is absent", async () => {
    // Nothing to compare and nothing to look for, so the row is produced without
    // credentials — a project with no .dev.vars is not an auth failure.
    const methods: string[] = [];
    const { configPath } = makeProject(null);
    await createSecretsHandler(configPath).reconcile(
      [],
      makeCtx({
        fetch: async (_u, init) => {
          methods.push((init?.method ?? "GET").toUpperCase());
          return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] }));
        },
      }),
    );
    expect(methods).toEqual([]);
  });

  it("opts into reportsEmpty so the engine does not skip it", () => {
    const { configPath } = makeProject(null);
    expect(createSecretsHandler(configPath).reportsEmpty).toBe(true);
  });

  it("surfaces the absent-.dev.vars note end-to-end through syncBindings", async () => {
    const { configPath } = makeProject(null);
    const out = await syncBindings({ name: "proj" }, { auth: AUTH, dryRun: true }, [createSecretsHandler(configPath)], makeFetch([]));
    expect(out.results).toEqual([]);
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]?.resourceType).toBe("secrets");
    expect(out.notes[0]?.message.startsWith("No .dev.vars at ")).toBe(true);
  });
});

describe("classification by marker", () => {
  const { configPath } = makeProject(`LOG_LEVEL=DEBUG\n${PUSH_MARKER}\nSTRIPE_KEY=v\n${GENERATE_MARKER}\nSESSION_SECRET=v\n`);

  it("gives the fixed handler only the secret-marked keys", () => {
    expect(
      createSecretsHandler(configPath)
        .extract({} as WranglerConfig)
        .map((e) => e.name),
    ).toEqual(["STRIPE_KEY"]);
  });

  it("gives the rotatable handler only the rotate-marked keys", () => {
    const entries = createRotatableSecretsHandler(configPath).extract({} as WranglerConfig);
    expect(entries.map((e) => e.name)).toEqual(["SESSION_SECRET"]);
  });

  it("gives neither handler an unmarked key — that is the local-vars handler's", () => {
    const seen = [
      ...createSecretsHandler(configPath).extract({} as WranglerConfig),
      ...createRotatableSecretsHandler(configPath).extract({} as WranglerConfig),
    ].map((e) => e.name);
    expect(seen).not.toContain("LOG_LEVEL");
  });

  it("labels its rows with its own resource type", async () => {
    const fixedRes = await createSecretsHandler(configPath).reconcile(
      [{ name: "STRIPE_KEY", value: "v" }],
      makeCtx({ fetch: makeFetch([]), dryRun: true }),
    );
    const rotRes = await createRotatableSecretsHandler(configPath).reconcile(
      [{ name: "SESSION_SECRET", value: "v" }],
      makeCtx({ fetch: makeFetch([]), dryRun: true }),
    );
    expect(fixedRes.results[0]?.resourceType).toBe("secrets");
    expect(rotRes.results[0]?.resourceType).toBe("rotatable_secrets");
  });
});

describe("fixed secrets — the local value is what goes remote", () => {
  const { configPath } = makeProject(fixed("SECRET_KEY"));
  const handler = createSecretsHandler(configPath);

  it("reports in-sync when the name is already there, on both sides", async () => {
    const res = await handler.reconcile([{ name: "SECRET_KEY", value: "val" }], makeCtx({ fetch: makeFetch(remote("SECRET_KEY")) }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, true]);
    // `in-sync` must not imply the values match — Cloudflare never returns them.
    expect(res.results[0]?.detail).toBe("name only (value not readable)");
  });

  it("creates the secret when it is not there", async () => {
    const res = await handler.reconcile([{ name: "NEW_SECRET", value: "val" }], makeCtx({ fetch: makeFetch([]) }));
    expect(res.results[0]?.action).toBe("created");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, true]);
  });

  it("names the pending create without --commit, and shows it absent remotely", async () => {
    const res = await handler.reconcile([{ name: "SECRET", value: "v" }], makeCtx({ fetch: makeFetch([]), dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
  });

  it("reports error when PUT fails", async () => {
    const res = await handler.reconcile([{ name: "BAD_SECRET", value: "v" }], makeCtx({ fetch: makeFetch([], false) }));
    expect(res.results[0]?.action).toBe("error");
  });

  it("distinguishes a missing target from an auth failure", async () => {
    const notFound: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "Could not route" }], messages: [], result: null }), {
        status: 404,
      });
    const badAuth: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 9106, message: "Authentication failed" }], messages: [], result: null }), {
        status: 400,
      });

    const missing = await handler.reconcile([{ name: "S", value: "v" }], makeCtx({ fetch: notFound }));
    const auth = await handler.reconcile([{ name: "S", value: "v" }], makeCtx({ fetch: badAuth }));

    expect(missing.results[0]?.detail).toBe("worker script · worker script not found: worker");
    expect(auth.results[0]?.detail).toBe(
      'worker script · auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change) · code 9106',
    );
    // The distinction lives in `action` too, so it survives being skimmed.
    expect(missing.results[0]?.action).toBe("unavailable");
    expect(auth.results[0]?.action).toBe("error");
  });
});

describe("rotatable secrets — the local value never leaves", () => {
  const { configPath } = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=local-value\n`);
  const handler = createRotatableSecretsHandler(configPath);
  const entry = [{ name: "SESSION_SECRET", value: "local-value" }];

  function capturingFetch(remoteSecrets: unknown[], sent: { text?: string }[]): typeof globalThis.fetch {
    return async (_url, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: {} }));
      }
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: remoteSecrets }));
    };
  }

  it("rotates a missing secret in on a plain --commit, without --rotate", async () => {
    // There is no old value to destroy, so nothing needs guarding — and requiring
    // --rotate for a first run would only be a step that can be forgotten.
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(entry, makeCtx({ fetch: capturingFetch([], sent) }));

    expect(sent[0]?.text).toMatch(/^[0-9a-f]{64}$/);
    expect(res.results[0]?.action).toBe("created");
  });

  it("generates that value rather than sending the local one", async () => {
    // The whole point of the marker: a development value must never become the
    // production one, not even on the run that first creates it.
    const sent: { text?: string }[] = [];
    await handler.reconcile(entry, makeCtx({ fetch: capturingFetch([], sent) }));
    expect(sent[0]?.text).not.toBe("local-value");
  });

  it("names the pending rotation without --commit, and shows it absent remotely", async () => {
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(entry, makeCtx({ fetch: capturingFetch([], sent), dryRun: true }));

    expect(sent).toHaveLength(0);
    expect(res.results[0]?.action).toBe("would-rotate");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
  });

  it("reports in-sync when the name is already there", async () => {
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(entry, makeCtx({ fetch: capturingFetch(remote("SESSION_SECRET"), sent) }));
    expect(sent).toHaveLength(0);
    expect(res.results[0]?.action).toBe("in-sync");
  });

  it("pushes a freshly generated value under --rotate, not the one in .dev.vars", async () => {
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(
      entry,
      makeCtx({ fetch: capturingFetch(remote("SESSION_SECRET"), sent), rotate: new Set(["SESSION_SECRET"]) }),
    );

    expect(sent[0]?.text).toMatch(/^[0-9a-f]{64}$/);
    expect(sent[0]?.text).not.toBe("local-value");
    expect(res.results[0]?.action).toBe("rotated");
    expect(res.results[0]?.detail).toBe("a new value was generated and pushed; .dev.vars is unchanged");
  });

  it("never puts the rotated value in a row", async () => {
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(
      entry,
      makeCtx({ fetch: capturingFetch(remote("SESSION_SECRET"), sent), rotate: new Set(["SESSION_SECRET"]) }),
    );
    expect(JSON.stringify(res.results)).not.toContain(sent[0]?.text as string);
  });

  it("leaves an existing secret alone unless --rotate names it", async () => {
    // The asymmetry that makes --rotate meaningful: creating destroys nothing,
    // replacing destroys the value in use.
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(entry, makeCtx({ fetch: capturingFetch(remote("SESSION_SECRET"), sent) }));
    expect(sent).toHaveLength(0);
    expect(res.results[0]?.action).toBe("in-sync");
  });

  it("writes nothing without --commit, and says what it would rotate", async () => {
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(
      entry,
      makeCtx({ fetch: capturingFetch(remote("SESSION_SECRET"), sent), rotate: new Set(["SESSION_SECRET"]), dryRun: true }),
    );
    expect(sent).toHaveLength(0);
    expect(res.results[0]?.action).toBe("would-rotate");
  });

  it("leaves a name --rotate did not mention on its existing value", async () => {
    const sent: { text?: string }[] = [];
    const res = await handler.reconcile(entry, makeCtx({ fetch: capturingFetch(remote("SESSION_SECRET"), sent), rotate: new Set(["OTHER"]) }));
    expect(sent).toHaveLength(0);
    expect(res.results[0]?.action).toBe("in-sync");
  });

  it("does not report orphans — one handler names them, or a remote secret is listed twice", async () => {
    const res = await handler.reconcile(entry, makeCtx({ fetch: makeFetch(remote("SOMEONE_ELSES")) }));
    expect(res.results.map((r) => r.binding)).toEqual(["SESSION_SECRET"]);
  });
});

describe("a remote secret nothing local claims", () => {
  it("is reported as remote-only, and never removed", async () => {
    const { configPath } = makeProject(fixed("MINE"));
    const res = await createSecretsHandler(configPath).reconcile(
      [{ name: "MINE", value: "v" }],
      makeCtx({ fetch: makeFetch(remote("MINE", "STALE_KEY")), dryRun: true }),
    );

    const orphan = res.results.find((r) => r.binding === "STALE_KEY");
    expect(orphan?.action).toBe("remote-only");
    expect([orphan?.local, orphan?.remote]).toEqual([false, true]);
    expect(orphan?.detail).toBe("not declared in .dev.vars; --commit never removes it");
  });

  it("counts a rotatable or unmarked key as claiming the name", async () => {
    // Only the fixed handler lists orphans, so it must recognise every local key —
    // otherwise a rotatable secret is reported both as awaiting rotation and as an orphan.
    const { configPath } = makeProject(`LOG_LEVEL=DEBUG\n${GENERATE_MARKER}\nSESSION_SECRET=v\n`);
    const res = await createSecretsHandler(configPath).reconcile([], makeCtx({ fetch: makeFetch(remote("SESSION_SECRET", "LOG_LEVEL")) }));
    expect(res.results).toEqual([]);
  });

  it("is found on the pages branch too", async () => {
    const { configPath } = makeProject(fixed("MINE"));
    const pagesFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { name: "p", deployment_configs: { production: { env_vars: { STALE_KEY: { type: "secret_text" } } } } },
        }),
      );
    const res = await createSecretsHandler(configPath).reconcile(
      [{ name: "MINE", value: "v" }],
      makeCtx({ fetch: pagesFetch, dryRun: true, target: { kind: "pages", name: "p" } }),
    );
    expect(res.results.find((r) => r.binding === "STALE_KEY")?.action).toBe("remote-only");
  });
});

describe("secret values never reach a result row", () => {
  const SENTINEL = "S3CR3T-SENTINEL";

  // The realistic leak is not a handler printing `entry.value` directly — it is a
  // failure detail piped from an API message, because Cloudflare echoes the
  // rejected payload back. So the stub's error message carries the sentinel.
  function echoingFetch(status: number, code: number): typeof globalThis.fetch {
    return async () =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code, message: `rejected value ${SENTINEL} for that binding` }], messages: [], result: null }),
        { status },
      );
  }

  const entries = [{ name: "CSRF_SECRET", value: SENTINEL }];

  it("holds across every branch, including an API error echoing the payload", async () => {
    const { configPath } = makeProject(`${PUSH_MARKER}\nCSRF_SECRET=${SENTINEL}\n`);
    const handler = createSecretsHandler(configPath);

    const runs = await Promise.all([
      handler.reconcile(entries, makeCtx({ fetch: makeFetch(remote("CSRF_SECRET")) })),
      handler.reconcile(entries, makeCtx({ fetch: makeFetch([]) })),
      handler.reconcile(entries, makeCtx({ fetch: makeFetch([]), dryRun: true })),
      handler.reconcile(entries, makeCtx({ fetch: makeFetch([], false) })),
      // list fails; create fails; unclassifiable failure; auth failure; missing target
      handler.reconcile(entries, makeCtx({ fetch: echoingFetch(500, 1234) })),
      handler.reconcile(entries, makeCtx({ fetch: echoingFetch(400, 9106) })),
      handler.reconcile(entries, makeCtx({ fetch: echoingFetch(404, 7003) })),
      handler.reconcile([], makeCtx({ fetch: makeFetch([]) })),
    ]);

    for (const run of runs) {
      expect(JSON.stringify(run.results)).not.toContain(SENTINEL);
    }
  });

  it("holds for the rotatable handler, whose local value is never sent at all", async () => {
    const { configPath } = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=${SENTINEL}\n`);
    const handler = createRotatableSecretsHandler(configPath);
    const rotatable = [{ name: "SESSION_SECRET", value: SENTINEL }];

    const runs = await Promise.all([
      handler.reconcile(rotatable, makeCtx({ fetch: makeFetch([]) })),
      handler.reconcile(rotatable, makeCtx({ fetch: makeFetch(remote("SESSION_SECRET")) })),
      handler.reconcile(rotatable, makeCtx({ fetch: makeFetch([]), rotate: new Set(["SESSION_SECRET"]) })),
      handler.reconcile(rotatable, makeCtx({ fetch: echoingFetch(400, 9106) })),
    ]);

    for (const run of runs) {
      expect(JSON.stringify(run.results)).not.toContain(SENTINEL);
    }
  });

  it("also holds for the rendered rows produced through syncBindings", async () => {
    const { configPath } = makeProject(`${PUSH_MARKER}\nCSRF_SECRET=${SENTINEL}\n${GENERATE_MARKER}\nSESSION_SECRET=${SENTINEL}\n`);
    const out = await syncBindings(
      { name: "proj" },
      { auth: AUTH },
      [createSecretsHandler(configPath), createRotatableSecretsHandler(configPath)],
      echoingFetch(500, 1234),
    );
    expect(out.results.length).toBeGreaterThan(0);
    expect(JSON.stringify(out.results)).not.toContain(SENTINEL);
  });
});

describe("fixed secrets — pages project", () => {
  const { configPath } = makeProject(fixed("CSRF_SECRET"));
  const handler = createSecretsHandler(configPath);

  function makePagesCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
    return makeCtx({ scriptName: "cornellaw", target: { kind: "pages", name: "cornellaw" }, ...overrides });
  }

  function makePagesFetch(
    envVars: Record<string, { type: string; value?: string }>,
    captured: { url: string; method: string; body: unknown }[],
    patchOk = true,
  ): typeof globalThis.fetch {
    return async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH") {
        captured.push({ url: String(url), method, body: JSON.parse(String(init?.body)) });
        if (!patchOk)
          return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "nope" }], messages: [], result: null }), {
            status: 400,
          });
        return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: {} }));
      }
      captured.push({ url: String(url), method, body: undefined });
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { name: "cornellaw", deployment_configs: { production: { env_vars: envVars, wrangler_config_hash: "hash-1" } } },
        }),
      );
    };
  }

  it("finds a secret by name and says the value was not compared", async () => {
    const captured: { url: string; method: string; body: unknown }[] = [];
    const fetchFn = makePagesFetch({ CSRF_SECRET: { type: "secret_text" } }, captured);

    const res = await handler.reconcile([{ name: "CSRF_SECRET", value: "v" }], makePagesCtx({ fetch: fetchFn }));

    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.detail).toBe("name only (value not readable)");
    expect(captured[0]?.url).toContain("/pages/projects/cornellaw");
  });

  it("does not mistake a plain_text var for a secret", async () => {
    const captured: { url: string; method: string; body: unknown }[] = [];
    const fetchFn = makePagesFetch({ CSRF_SECRET: { type: "plain_text", value: "x" } }, captured);
    const res = await handler.reconcile([{ name: "CSRF_SECRET", value: "v" }], makePagesCtx({ fetch: fetchFn, dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
  });

  it("creates via a PATCH with the documented body shape", async () => {
    const captured: { url: string; method: string; body: unknown }[] = [];
    const fetchFn = makePagesFetch({}, captured);

    const res = await handler.reconcile([{ name: "CSRF_SECRET", value: "v" }], makePagesCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("created");

    const patch = captured.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/pages/projects/cornellaw");
    expect(patch?.body).toEqual({
      deployment_configs: { production: { env_vars: { CSRF_SECRET: { type: "secret_text", value: "v" } }, wrangler_config_hash: "hash-1" } },
    });
  });

  it("reports a missing project as unavailable rather than as an auth error", async () => {
    const notFound: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "Could not route" }], messages: [], result: null }), {
        status: 404,
      });
    const res = await handler.reconcile([{ name: "S", value: "v" }], makePagesCtx({ fetch: notFound }));
    expect(res.results[0]?.action).toBe("unavailable");
    expect(res.results[0]?.detail).toBe("pages project · pages project not found: cornellaw");
  });

  it("keeps the secret value out of rows even when the PATCH is rejected", async () => {
    const captured: { url: string; method: string; body: unknown }[] = [];
    const fetchFn = makePagesFetch({}, captured, false);
    const res = await handler.reconcile([{ name: "CSRF_SECRET", value: "S3CR3T-SENTINEL" }], makePagesCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("error");
    expect(JSON.stringify(res.results)).not.toContain("S3CR3T-SENTINEL");
  });

  it("does not push a rotatable secret on this branch either", async () => {
    const { configPath: rotatablePath } = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=local\n`);
    const captured: { url: string; method: string; body: unknown }[] = [];
    const res = await createRotatableSecretsHandler(rotatablePath).reconcile(
      [{ name: "SESSION_SECRET", value: "local" }],
      makePagesCtx({ fetch: makePagesFetch({}, captured), dryRun: true }),
    );
    expect(captured.map((c) => c.method)).toEqual(["GET"]);
    expect(res.results[0]?.action).toBe("would-rotate");
  });
});

describe("a secret is not a binding", () => {
  // The two facts the report's prose kept getting wrong. A secret has no id and takes no prefix:
  // it is created under its own name, and it either exists remotely or it does not. The prefix and
  // the write-back belong to KV, D1, R2 and queues — resources created independently and then
  // linked — and claiming them for secrets promises a config edit that nothing ever makes.
  const PREFIXED = makeCtx({ prefix: "CORNELLAW" });

  it("ignores the prefix, even where one is set for the run", async () => {
    const { configPath } = makeProject(fixed("STRIPE_KEY"));
    const handler = createSecretsHandler(configPath);
    const { results } = await handler.reconcile(handler.extract({} as WranglerConfig), { ...PREFIXED, fetch: makeFetch(remote()) });
    expect(results.map((r) => [r.binding, r.remoteName])).toEqual([["STRIPE_KEY", "STRIPE_KEY"]]);
  });

  it("never carries a remote id, because nothing assigns one", async () => {
    const { configPath } = makeProject(fixed("A", "B"));
    const handler = createSecretsHandler(configPath);
    const { results } = await handler.reconcile(handler.extract({} as WranglerConfig), { ...PREFIXED, fetch: makeFetch(remote("A")) });
    expect(results.map((r) => r.remoteId)).toEqual([undefined, undefined]);
  });

  it("says create, not update, for one that is simply not there", async () => {
    const { configPath } = makeProject(fixed("STRIPE_KEY"));
    const handler = createSecretsHandler(configPath);
    const { results } = await handler.reconcile(handler.extract({} as WranglerConfig), { ...PREFIXED, dryRun: true, fetch: makeFetch(remote()) });
    expect(results.map((r) => r.action)).toEqual(["would-create"]);
  });

  it("leaves the wrangler config untouched, so there is nothing to write back", async () => {
    const { configPath } = makeProject(fixed("STRIPE_KEY"));
    const config: WranglerConfig = { name: "proj" };
    const out = await syncBindings(
      config,
      { auth: AUTH, prefix: { kind: "custom", prefix: "CORNELLAW" } },
      [createSecretsHandler(configPath)],
      makeFetch(remote()),
    );
    expect(out.configChanged).toBe(false);
  });
});
