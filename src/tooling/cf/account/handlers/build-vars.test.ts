import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SyncResult } from "../../types";
import { failsRun } from "../commands";
import { syncBindings } from "../engine";
import { createBuildVarsHandler } from "./build-vars";
import type { HandlerContext, ResourceHandler } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-build-vars-"));
  roots.push(root);
  return root;
}

function configBeside(packageJson: string | undefined): string {
  const root = projectRoot();
  if (packageJson !== undefined) writeFileSync(join(root, "package.json"), packageJson);
  writeFileSync(join(root, "wrangler.jsonc"), "{}");
  return join(root, "wrangler.jsonc");
}

const pinned = (packageManager: unknown) => configBeside(JSON.stringify({ name: "app", packageManager }));

type BuildVariable = { value?: string | null; is_secret: boolean };
type BuildScope = { environment_variables?: Record<string, BuildVariable> | null } | null;
type BuildSettings = { production_settings?: BuildScope; previews_base_config?: BuildScope; previews_enabled?: boolean };
type Failure = { status: number; codes?: number[]; message?: string };

interface FakeAccount {
  scripts?: { id: string; tag: string }[];
  settings?: BuildSettings;
  failScripts?: Failure;
  failSettings?: Failure;
  failPatch?: Failure;
}

interface SentRequest {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

const envelope = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], messages: [], result }));

const refusal = ({ status, codes = [], message = "upstream refusal" }: Failure) =>
  new Response(
    JSON.stringify({
      success: false,
      errors: codes.length > 0 ? codes.map((code) => ({ code, message })) : [{ message }],
      messages: [],
      result: null,
    }),
    { status },
  );

function fakeCloudflare(account: FakeAccount) {
  const sent: SentRequest[] = [];
  const settings: BuildSettings = structuredClone(account.settings ?? {});

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({ method, path: url.pathname, search: url.search, body });

    if (url.pathname.endsWith("/workers/scripts")) {
      return account.failScripts ? refusal(account.failScripts) : envelope(account.scripts ?? [{ id: "worker", tag: "t1" }]);
    }
    if (method === "GET") return account.failSettings ? refusal(account.failSettings) : envelope(settings);
    if (account.failPatch) return refusal(account.failPatch);

    for (const [key, scope] of Object.entries(body as Record<"production_settings" | "previews_base_config", BuildScope>)) {
      const stored = settings[key as "production_settings" | "previews_base_config"] ?? {};
      stored.environment_variables = { ...stored.environment_variables, ...scope?.environment_variables };
      settings[key as "production_settings" | "previews_base_config"] = stored;
    }
    return envelope({});
  };

  return { fetch, sent, patches: () => sent.filter((r) => r.method === "PATCH") };
}

function ctx(fetch: typeof globalThis.fetch, overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: { apiToken: "tok", accountId: "acc" },
    scriptName: "worker",
    prefix: "",
    dryRun: true,
    rotate: new Set<string>(),
    fetch,
    ...overrides,
  };
}

async function reconcile(configPath: string, account: FakeAccount, overrides: Partial<HandlerContext> = {}) {
  const cloudflare = fakeCloudflare(account);
  const handler = createBuildVarsHandler(configPath);
  const { results } = await handler.reconcile(handler.extract({ name: "worker" }), ctx(cloudflare.fetch, overrides));
  return { results, ...cloudflare };
}

const production = (variables: Record<string, BuildVariable> | null | undefined): BuildSettings => ({
  production_settings: variables === undefined ? {} : { environment_variables: variables },
  previews_enabled: false,
});

const bothScopes = (productionVariables: Record<string, BuildVariable>, previews: Record<string, BuildVariable>): BuildSettings => ({
  production_settings: { environment_variables: productionVariables },
  previews_base_config: { environment_variables: previews },
  previews_enabled: true,
});

const row = (action: SyncResult["action"], fields: Partial<SyncResult>): SyncResult => ({
  resourceType: "build_vars",
  binding: "BUN_VERSION",
  action,
  local: true,
  ...fields,
});

const SETTINGS_PATH = "/client/v4/accounts/acc/builds/workers/t1";

const WORKERS_CI_AUTH_FAILURE =
  'worker script · auth failed — the --api-token is rejected or lacks "Workers CI" (Read to report, Write to change, on a user-scoped token — an account-scoped one is refused as invalid)';

describe("createBuildVarsHandler — reading the pin from package.json", () => {
  it("reports nothing when the config's directory holds no package.json", () => {
    expect(createBuildVarsHandler(configBeside(undefined)).extract({ name: "worker" })).toEqual([]);
  });

  for (const { label, packageManager } of [
    { label: "no packageManager", packageManager: undefined },
    { label: "a pnpm packageManager", packageManager: "pnpm@9.0.0" },
    { label: "a non-string packageManager", packageManager: 42 },
  ]) {
    it(`reports nothing for ${label}`, () => {
      expect(createBuildVarsHandler(pinned(packageManager)).extract({ name: "worker" })).toEqual([]);
    });
  }

  it("reads the package.json beside the config, never one in a parent directory", () => {
    const root = projectRoot();
    writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: "bun@1.3.1" }));
    mkdirSync(join(root, "app"));
    expect(createBuildVarsHandler(join(root, "app", "wrangler.jsonc")).extract({ name: "worker" })).toEqual([]);
  });

  it("is not a handler that reports on an empty extract", () => {
    expect(createBuildVarsHandler(configBeside(undefined)).reportsEmpty).toBeFalsy();
  });

  it("returns no rows and sends nothing when reconciled with no entry", async () => {
    const cloudflare = fakeCloudflare({});
    const { results } = await createBuildVarsHandler(configBeside(undefined)).reconcile([], ctx(cloudflare.fetch));
    expect(results).toEqual([]);
    expect(cloudflare.sent).toEqual([]);
  });

  it("produces no row and no request through syncBindings when package.json pins no bun@", async () => {
    const cloudflare = fakeCloudflare({});
    const output = await syncBindings(
      { name: "worker" },
      { auth: { apiToken: "tok", accountId: "acc" }, dryRun: true },
      [createBuildVarsHandler(pinned("pnpm@9.0.0")) as ResourceHandler],
      cloudflare.fetch,
    );
    expect(output.results).toEqual([]);
    expect(cloudflare.sent).toEqual([]);
  });
});

describe("createBuildVarsHandler — a pin that is not one exact version", () => {
  for (const packageManager of ["bun@^1.3.0", "bun@latest", "bun@1.3", "bun@1.3.0-canary.1", "bun@1.3.1+"]) {
    it(`refuses ${packageManager} without calling Cloudflare, and fails the run`, async () => {
      const { results, sent } = await reconcile(pinned(packageManager), { settings: production({}) });
      expect(results).toEqual([
        row("refused", { detail: `packageManager "${packageManager}" is not an exact bun@X.Y.Z — Workers Builds needs one version to install` }),
      ]);
      expect(sent).toEqual([]);
      expect(failsRun(results)).toBe(true);
    });
  }

  it("refuses a package.json that is not JSON, naming the file", async () => {
    const configPath = configBeside("{ not json");
    const { results, sent } = await reconcile(configPath, {});
    expect(results).toEqual([row("refused", { detail: `${join(configPath, "..", "package.json")} is not valid JSON` })]);
    expect(sent).toEqual([]);
  });

  it("refuses a package.json whose top level is not an object", async () => {
    const configPath = configBeside("null");
    const { results } = await reconcile(configPath, {});
    expect(results).toEqual([row("refused", { detail: `${join(configPath, "..", "package.json")} is not valid JSON` })]);
  });
});

describe("createBuildVarsHandler — status, without --commit", () => {
  it("reads in-sync when production already holds the pinned version, and writes nothing", async () => {
    const { results, sent } = await reconcile(pinned("bun@1.3.1"), { settings: production({ BUN_VERSION: { value: "1.3.1", is_secret: false } }) });
    expect(results).toEqual([row("in-sync", { remote: true, detail: "production" })]);
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /client/v4/accounts/acc/workers/scripts", `GET ${SETTINGS_PATH}`]);
  });

  it("compares a Corepack hash-pinned entry by its version alone", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1+sha512.abc123"), {
      settings: production({ BUN_VERSION: { value: "1.3.1", is_secret: false } }),
    });
    expect(results).toEqual([row("in-sync", { remote: true, detail: "production" })]);
  });

  it("reports drift from the remote value to the pinned one, and writes nothing", async () => {
    const { results, patches } = await reconcile(pinned("bun@1.3.1"), {
      settings: production({ BUN_VERSION: { value: "1.2.15", is_secret: false } }),
    });
    expect(results).toEqual([row("drift", { remote: true, detail: 'production · "1.2.15" → "1.3.1"' })]);
    expect(patches()).toEqual([]);
  });

  it("reports drift from an empty value when the remote variable holds none", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), { settings: production({ BUN_VERSION: { value: null, is_secret: false } }) });
    expect(results).toEqual([row("drift", { remote: true, detail: 'production · "" → "1.3.1"' })]);
  });

  it("reports drift it cannot read when the remote variable is a secret", async () => {
    const { results, patches } = await reconcile(pinned("bun@1.3.1"), { settings: production({ BUN_VERSION: { is_secret: true } }) });
    expect(results).toEqual([row("drift", { remote: true, detail: "production · set as a secret, so its value is unreadable" })]);
    expect(patches()).toEqual([]);
  });

  for (const { label, variables } of [
    { label: "holds other variables only", variables: { NODE_VERSION: { value: "22", is_secret: false } } },
    { label: "is null", variables: null },
    { label: "is absent", variables: undefined },
  ]) {
    it(`reports would-create when the scope's variable map ${label}`, async () => {
      const { results, patches } = await reconcile(pinned("bun@1.3.1"), { settings: production(variables) });
      expect(results).toEqual([row("would-create", { remote: false, detail: "production" })]);
      expect(patches()).toEqual([]);
    });
  }
});

describe("createBuildVarsHandler — which build scopes it reports", () => {
  const holding = (value: string) => ({ BUN_VERSION: { value, is_secret: false } });

  it("reports production and previews when previews are enabled", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), { settings: bothScopes(holding("1.3.1"), holding("1.2.15")) });
    expect(results).toEqual([
      row("in-sync", { remote: true, detail: "production" }),
      row("drift", { remote: true, detail: 'previews · "1.2.15" → "1.3.1"' }),
    ]);
  });

  it("leaves previews out when they are disabled, even with a previews configuration present", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), {
      settings: { ...bothScopes(holding("1.3.1"), holding("1.2.15")), previews_enabled: false },
    });
    expect(results).toEqual([row("in-sync", { remote: true, detail: "production" })]);
  });

  it("leaves previews out when they are enabled but have no configuration", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), {
      settings: { production_settings: { environment_variables: holding("1.3.1") }, previews_base_config: null, previews_enabled: true },
    });
    expect(results).toEqual([row("in-sync", { remote: true, detail: "production" })]);
  });

  it("reports previews alone when production has no configuration", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), {
      settings: { production_settings: null, previews_base_config: { environment_variables: holding("1.3.1") }, previews_enabled: true },
    });
    expect(results).toEqual([row("in-sync", { remote: true, detail: "previews" })]);
  });
});

describe("createBuildVarsHandler — --commit", () => {
  const BUN_ONLY = (scope: string) => ({ [scope]: { environment_variables: { BUN_VERSION: { value: "1.3.1", is_secret: false } } } });

  it("creates the variable in production with one PATCH carrying BUN_VERSION alone", async () => {
    const { results, patches } = await reconcile(pinned("bun@1.3.1"), { settings: production({}) }, { dryRun: false });
    expect(results).toEqual([row("created", { remote: true, detail: "production · 1.3.1" })]);
    expect(patches()).toEqual([{ method: "PATCH", path: SETTINGS_PATH, search: "", body: BUN_ONLY("production_settings") }]);
  });

  it("writes the version without its Corepack hash", async () => {
    const { patches } = await reconcile(pinned("bun@1.3.1+sha512.abc123"), { settings: production({}) }, { dryRun: false });
    expect(patches().map((r) => r.body)).toEqual([BUN_ONLY("production_settings")]);
  });

  it("never sends back the other build variables it read", async () => {
    const { patches } = await reconcile(
      pinned("bun@1.3.1"),
      {
        settings: production({
          BUN_VERSION: { value: "1.2.15", is_secret: false },
          NODE_VERSION: { value: "22", is_secret: false },
          NPM_TOKEN: { value: null, is_secret: true },
        }),
      },
      { dryRun: false },
    );
    expect(patches().map((r) => r.body)).toEqual([BUN_ONLY("production_settings")]);
  });

  it("updates both scopes, patching existing previews only on the previews write", async () => {
    const stale = { BUN_VERSION: { value: "1.2.15", is_secret: false } };
    const { results, patches } = await reconcile(pinned("bun@1.3.1"), { settings: bothScopes(stale, stale) }, { dryRun: false });
    expect(results).toEqual([
      row("updated", { remote: true, detail: "production · 1.3.1" }),
      row("updated", { remote: true, detail: "previews · 1.3.1" }),
    ]);
    expect(patches()).toEqual([
      { method: "PATCH", path: SETTINGS_PATH, search: "", body: BUN_ONLY("production_settings") },
      { method: "PATCH", path: SETTINGS_PATH, search: "?patch_existing_previews=true", body: BUN_ONLY("previews_base_config") },
    ]);
  });

  it("overwrites a secret variable as a plain one, since its value cannot be compared", async () => {
    const { results, patches } = await reconcile(
      pinned("bun@1.3.1"),
      { settings: production({ BUN_VERSION: { is_secret: true } }) },
      { dryRun: false },
    );
    expect(results).toEqual([row("updated", { remote: true, detail: "production · 1.3.1" })]);
    expect(patches().map((r) => r.body)).toEqual([BUN_ONLY("production_settings")]);
  });

  it("sends no PATCH for a scope already in sync", async () => {
    const { results, patches } = await reconcile(
      pinned("bun@1.3.1"),
      { settings: production({ BUN_VERSION: { value: "1.3.1", is_secret: false } }) },
      { dryRun: false },
    );
    expect(results).toEqual([row("in-sync", { remote: true, detail: "production" })]);
    expect(patches()).toEqual([]);
  });

  it("reads in-sync on the status run that follows a commit", async () => {
    const cloudflare = fakeCloudflare({ settings: bothScopes({}, { BUN_VERSION: { value: "1.2.15", is_secret: false } }) });
    const handler = createBuildVarsHandler(pinned("bun@1.3.1"));
    const entries = handler.extract({ name: "worker" });

    const committed = await handler.reconcile(entries, ctx(cloudflare.fetch, { dryRun: false }));
    const status = await handler.reconcile(entries, ctx(cloudflare.fetch));

    expect(committed.results.map((r) => r.action)).toEqual(["created", "updated"]);
    expect(status.results).toEqual([row("in-sync", { remote: true, detail: "production" }), row("in-sync", { remote: true, detail: "previews" })]);
    expect(cloudflare.patches()).toHaveLength(2);
  });
});

describe("createBuildVarsHandler — finding the Worker's build settings", () => {
  it("addresses the settings by the matching script's tag, not its name", async () => {
    const { sent } = await reconcile(pinned("bun@1.3.1"), {
      scripts: [
        { id: "worker-two", tag: "t2" },
        { id: "worker", tag: "tag-of-worker" },
      ],
      settings: production({}),
    });
    expect(sent[1]?.path).toBe("/client/v4/accounts/acc/builds/workers/tag-of-worker");
  });

  it("matches a script whose name needs encoding by its id, and encodes the tag", async () => {
    const { sent } = await reconcile(
      pinned("bun@1.3.1"),
      { scripts: [{ id: "a/b", tag: "t/1" }], settings: production({}) },
      { scriptName: "a/b" },
    );
    expect(sent[1]?.path).toBe("/client/v4/accounts/acc/builds/workers/t%2F1");
  });

  it("reads the whole script list in one unpaged request, so a large account is not refused", async () => {
    const scripts = Array.from({ length: 150 }, (_, i) => ({ id: `other-${i}`, tag: `o${i}` }));
    const { results, sent } = await reconcile(pinned("bun@1.3.1"), {
      scripts: [...scripts, { id: "worker", tag: "t1" }],
      settings: production({ BUN_VERSION: { value: "1.3.1", is_secret: false } }),
    });
    expect(results).toEqual([row("in-sync", { remote: true, detail: "production" })]);
    expect(sent[0]?.search).toBe("");
  });

  it("reads unavailable when the Worker is not deployed, without asking for build settings", async () => {
    const { results, sent } = await reconcile(pinned("bun@1.3.1"), { scripts: [{ id: "someone-else", tag: "t9" }] });
    expect(results).toEqual([row("unavailable", { detail: "worker script · not deployed: worker" })]);
    expect(sent).toHaveLength(1);
  });

  for (const { label, failSettings } of [
    { label: "a 404 carrying code 7003", failSettings: { status: 404, codes: [7003] } },
    { label: "a 404 carrying no code", failSettings: { status: 404 } },
  ]) {
    it(`reads unavailable when the Worker has no Workers Builds configuration (${label})`, async () => {
      const { results, patches } = await reconcile(pinned("bun@1.3.1"), { failSettings }, { dryRun: false });
      expect(results).toEqual([row("unavailable", { detail: "worker script · no Workers Builds configuration for worker" })]);
      expect(patches()).toEqual([]);
    });
  }

  it("reads unavailable when both build scopes are null", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), {
      settings: { production_settings: null, previews_base_config: null, previews_enabled: true },
    });
    expect(results).toEqual([row("unavailable", { detail: "worker script · no Workers Builds configuration for worker" })]);
  });
});

describe("createBuildVarsHandler — failures", () => {
  it("names the Workers CI permission and the user-scoped token when the settings read is refused with code 10000", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), { failSettings: { status: 400, codes: [10000] } });
    expect(results).toEqual([row("error", { detail: `${WORKERS_CI_AUTH_FAILURE} · code 10000` })]);
    expect(failsRun(results)).toBe(true);
  });

  it("names the Workers CI permission and the user-scoped token on a codeless 403", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), { failSettings: { status: 403 } });
    expect(results).toEqual([row("error", { detail: WORKERS_CI_AUTH_FAILURE })]);
  });

  it("reports an unrecognised settings failure with Cloudflare's message", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), { failSettings: { status: 500, codes: [1234], message: "Internal failure" } });
    expect(results).toEqual([row("error", { detail: "worker script · Internal failure" })]);
  });

  it("names Workers CI when the PATCH is refused, keeping remote true for a variable that exists", async () => {
    const { results } = await reconcile(
      pinned("bun@1.3.1"),
      { settings: production({ BUN_VERSION: { value: "1.2.15", is_secret: false } }), failPatch: { status: 403 } },
      { dryRun: false },
    );
    expect(results).toEqual([row("error", { remote: true, detail: WORKERS_CI_AUTH_FAILURE })]);
  });

  it("keeps remote false when the refused PATCH was creating the variable", async () => {
    const { results } = await reconcile(pinned("bun@1.3.1"), { settings: production({}), failPatch: { status: 403 } }, { dryRun: false });
    expect(results).toEqual([row("error", { remote: false, detail: WORKERS_CI_AUTH_FAILURE })]);
  });

  it("names Workers Scripts, not Workers CI, when the script list is refused", async () => {
    const { results, sent } = await reconcile(pinned("bun@1.3.1"), { failScripts: { status: 403 } });
    expect(results).toEqual([
      {
        resourceType: "build_vars",
        binding: "BUN_VERSION",
        remoteName: undefined,
        action: "error",
        detail: 'worker script · auth failed — the --api-token is rejected or lacks "Workers Scripts" (Read to report, Edit to change)',
      },
    ]);
    expect(sent).toHaveLength(1);
  });
});
