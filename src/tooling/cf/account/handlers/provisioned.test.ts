import { describe, expect, it } from "bun:test";

import { err, ok } from "../../../../result/result";
import type { Result } from "../../../../result/types";
import type { CfApiError } from "../../api/types";
import { CfApiClientError } from "../../api/types";
import type { WranglerConfig } from "../../types";
import { createProvisionedHandler } from "./provisioned";
import type { ProvisionSpec, RemoteResource } from "./types";
import type { HandlerContext } from "./types";

interface Local {
  binding: string;
  id?: string | undefined;
  name?: string | undefined;
}

const cf = (...codes: number[]): CfApiError[] => codes.map((code) => ({ code, message: `upstream ${code}` }));

const ctx = (overrides: Partial<HandlerContext> = {}): HandlerContext => ({
  auth: { apiToken: "tok", accountId: "acc-1" },
  scriptName: "my-worker",
  prefix: "",
  dryRun: false,
  rotate: new Set<string>(),
  fetch: () => Promise.reject(new Error("the spec owns every request; the ladder must make none of its own")),
  target: { kind: "worker", name: "my-worker" },
  ...overrides,
});

interface SpecOptions {
  list?: Result<RemoteResource[], CfApiClientError>;
  create?: Result<RemoteResource, CfApiClientError>;
  withLocalId?: boolean;
  withLocalName?: boolean;
}

interface Harness {
  handler: ReturnType<typeof createProvisionedHandler<Local>>;
  created: string[];
  listedAccounts: string[];
}

function harness(options: SpecOptions = {}): Harness {
  const created: string[] = [];
  const listedAccounts: string[] = [];
  const spec: ProvisionSpec<Local> = {
    type: "kv_namespaces",
    displayName: "KV namespaces",
    extract: (config: WranglerConfig) => (config.kv_namespaces ?? []) as Local[],
    list: (_client, accountId) => {
      listedAccounts.push(accountId);
      return Promise.resolve(options.list ?? ok([]));
    },
    create: (_client, _accountId, name) => {
      created.push(name);
      return Promise.resolve(options.create ?? ok({ id: `new-${name}`, name }));
    },
    naming: (prefix, binding) => (prefix ? `${prefix}_${binding}` : binding),
    writeback: (entry, remote, name) => ({ ...entry, id: remote.id, name }),
    ...(options.withLocalId === false ? {} : { localId: (entry: Local) => entry.id }),
    ...(options.withLocalName ? { localName: (entry: Local) => entry.name } : {}),
  };
  return { handler: createProvisionedHandler(spec), created, listedAccounts };
}

describe("createProvisionedHandler — the spec's own fields", () => {
  it("publishes the spec's type and display name", () => {
    const { handler } = harness();
    expect([handler.type, handler.displayName]).toEqual(["kv_namespaces", "KV namespaces"]);
  });

  it("extracts through the spec", () => {
    const { handler } = harness();
    expect(handler.extract({ name: "app", kv_namespaces: [{ binding: "CACHE" }] } as WranglerConfig)).toEqual([{ binding: "CACHE" }]);
  });

  it("extracts nothing from a config declaring none", () => {
    const { handler } = harness();
    expect(handler.extract({ name: "app" } as WranglerConfig)).toEqual([]);
  });
});

describe("createProvisionedHandler — no entries", () => {
  it("returns nothing and never lists, so an absent binding costs no request", async () => {
    const { handler, listedAccounts } = harness();
    const res = await handler.reconcile([], ctx());
    expect([res.entries, res.results, listedAccounts]).toEqual([[], [], []]);
  });
});

describe("createProvisionedHandler — the list fails", () => {
  it("returns every entry untouched and one failure row per binding", async () => {
    const error = new CfApiClientError("api", "Authentication error", { statusCode: 403, cfErrors: cf(10000) });
    const { handler, created } = harness({ list: err(error) });
    const entries: Local[] = [{ binding: "CACHE", id: "ns-1" }, { binding: "SESSIONS" }];

    const res = await handler.reconcile(entries, ctx());

    expect(res.entries).toEqual([{ binding: "CACHE", id: "ns-1" }, { binding: "SESSIONS" }]);
    expect(res.results.map((r) => [r.binding, r.action])).toEqual([
      ["CACHE", "error"],
      ["SESSIONS", "error"],
    ]);
    expect(created).toEqual([]);
  });

  it("reports a missing account surface as unavailable", async () => {
    const error = new CfApiClientError("api", "Could not route", { statusCode: 404, cfErrors: cf(7003) });
    const { handler } = harness({ list: err(error) });
    const res = await handler.reconcile([{ binding: "CACHE" }], ctx());
    expect(res.results).toEqual([
      {
        resourceType: "kv_namespaces",
        binding: "CACHE",
        remoteName: undefined,
        action: "unavailable",
        detail: "worker script · worker script not found: my-worker",
      },
    ]);
  });

  it("lists against the account id from the context auth", async () => {
    const { handler, listedAccounts } = harness();
    await handler.reconcile([{ binding: "CACHE" }], ctx({ auth: { apiToken: "tok", accountId: "acc-other" } }));
    expect(listedAccounts).toEqual(["acc-other"]);
  });
});

describe("createProvisionedHandler — matched by id", () => {
  it("reports in-sync under the remote's own name and writes nothing back", async () => {
    const { handler, created } = harness({ list: ok([{ id: "ns-legacy", name: "hand-made" }]) });
    const res = await handler.reconcile([{ binding: "CACHE", id: "ns-legacy" }], ctx({ prefix: "PROJ" }));

    expect(res.results).toEqual([
      {
        resourceType: "kv_namespaces",
        binding: "CACHE",
        local: true,
        remoteName: "hand-made",
        action: "in-sync",
        remote: true,
        remoteId: "ns-legacy",
      },
    ]);
    expect(res.entries).toEqual([{ binding: "CACHE", id: "ns-legacy" }]);
    expect(created).toEqual([]);
  });

  it("prefers the id over a remote whose name is what this run would have computed", async () => {
    const { handler } = harness({
      list: ok([
        { id: "ns-bound", name: "unrelated" },
        { id: "ns-namesake", name: "CACHE" },
      ]),
    });
    const res = await handler.reconcile([{ binding: "CACHE", id: "ns-bound" }], ctx());
    expect([res.results[0]?.remoteId, res.results[0]?.remoteName]).toEqual(["ns-bound", "unrelated"]);
  });

  it("skips the id step for a spec that declares no localId", async () => {
    const { handler } = harness({ list: ok([{ id: "ns-legacy", name: "hand-made" }]), withLocalId: false });
    const res = await handler.reconcile([{ binding: "CACHE", id: "ns-legacy" }], ctx());
    expect([res.results[0]?.action, res.results[0]?.remoteName]).toEqual(["created", "CACHE"]);
  });
});

describe("createProvisionedHandler — matched by name", () => {
  it("reports in-sync and writes the remote id back into the entry", async () => {
    const { handler, created } = harness({ list: ok([{ id: "ns-1", name: "PROJ_CACHE" }]) });
    const res = await handler.reconcile([{ binding: "CACHE" }], ctx({ prefix: "PROJ" }));

    expect(res.results).toEqual([
      {
        resourceType: "kv_namespaces",
        binding: "CACHE",
        local: true,
        remoteName: "PROJ_CACHE",
        action: "in-sync",
        remote: true,
        remoteId: "ns-1",
        detail: undefined,
      },
    ]);
    expect(res.entries).toEqual([{ binding: "CACHE", id: "ns-1", name: "PROJ_CACHE" }]);
    expect(created).toEqual([]);
  });

  it("falls back to the remote name as the id when the resource has none", async () => {
    const { handler } = harness({ list: ok([{ name: "assets" }]), withLocalId: false, withLocalName: true });
    const res = await handler.reconcile([{ binding: "BUCKET", name: "assets" }], ctx({ prefix: "PROJ" }));
    expect([res.results[0]?.action, res.results[0]?.remoteId]).toEqual(["in-sync", "assets"]);
  });

  it("names the stale id on the row it matched by name instead", async () => {
    const { handler } = harness({ list: ok([{ id: "ns-current", name: "CACHE" }]) });
    const res = await handler.reconcile([{ binding: "CACHE", id: "ns-deleted" }], ctx());
    expect(res.results[0]?.detail).toBe("local id ns-deleted not found on this account");
    expect(res.entries).toEqual([{ binding: "CACHE", id: "ns-current", name: "CACHE" }]);
  });

  it("lets an explicit config name win over the computed one", async () => {
    const { handler, created } = harness({ list: ok([{ id: "ns-1", name: "chosen-by-hand" }]), withLocalName: true });
    const res = await handler.reconcile([{ binding: "CACHE", name: "chosen-by-hand" }], ctx({ prefix: "PROJ" }));
    expect([res.results[0]?.action, res.results[0]?.remoteName]).toEqual(["in-sync", "chosen-by-hand"]);
    expect(created).toEqual([]);
  });

  it("computes the name when the config leaves it unset on a spec that reads one", async () => {
    const { handler, created } = harness({ list: ok([]), withLocalName: true });
    await handler.reconcile([{ binding: "CACHE" }], ctx({ prefix: "PROJ" }));
    expect(created).toEqual(["PROJ_CACHE"]);
  });
});

describe("createProvisionedHandler — dry run", () => {
  it("reports would-create and creates nothing", async () => {
    const { handler, created } = harness({ list: ok([]) });
    const res = await handler.reconcile([{ binding: "CACHE" }], ctx({ dryRun: true, prefix: "PROJ" }));

    expect(res.results).toEqual([
      {
        resourceType: "kv_namespaces",
        binding: "CACHE",
        local: true,
        remoteName: "PROJ_CACHE",
        action: "would-create",
        remote: false,
        detail: undefined,
      },
    ]);
    expect(res.entries).toEqual([{ binding: "CACHE" }]);
    expect(created).toEqual([]);
  });

  it("still names a stale id on the row it would create", async () => {
    const { handler } = harness({ list: ok([]) });
    const res = await handler.reconcile([{ binding: "CACHE", id: "ns-deleted" }], ctx({ dryRun: true }));
    expect(res.results[0]?.detail).toBe("local id ns-deleted not found on this account");
  });
});

describe("createProvisionedHandler — creation", () => {
  it("creates under the computed name and writes the result back", async () => {
    const { handler, created } = harness({ list: ok([]) });
    const res = await handler.reconcile([{ binding: "CACHE" }], ctx({ prefix: "PROJ" }));

    expect(created).toEqual(["PROJ_CACHE"]);
    expect(res.results).toEqual([
      {
        resourceType: "kv_namespaces",
        binding: "CACHE",
        local: true,
        remoteName: "PROJ_CACHE",
        action: "created",
        remote: true,
        remoteId: "new-PROJ_CACHE",
        detail: undefined,
      },
    ]);
    expect(res.entries).toEqual([{ binding: "CACHE", id: "new-PROJ_CACHE", name: "PROJ_CACHE" }]);
  });

  it("falls back to the requested name as the id when the created resource has none", async () => {
    const { handler } = harness({ list: ok([]), create: ok({ name: "assets" }) });
    const res = await handler.reconcile([{ binding: "BUCKET" }], ctx());
    expect(res.results[0]?.remoteId).toBe("BUCKET");
  });

  it("reports the failure against the name it tried and leaves the entry alone", async () => {
    const error = new CfApiClientError("api", "already exists", { statusCode: 409 });
    const { handler } = harness({ list: ok([]), create: err(error) });
    const res = await handler.reconcile([{ binding: "CACHE" }], ctx());

    expect(res.results).toEqual([
      { resourceType: "kv_namespaces", binding: "CACHE", remoteName: "CACHE", action: "error", detail: "worker script · already exists" },
    ]);
    expect(res.entries).toEqual([{ binding: "CACHE" }]);
  });

  it("carries on to the next binding after one creation fails", async () => {
    const error = new CfApiClientError("api", "already exists", { statusCode: 409 });
    const { handler, created } = harness({ list: ok([{ id: "ns-2", name: "SESSIONS" }]), create: err(error) });
    const res = await handler.reconcile([{ binding: "CACHE" }, { binding: "SESSIONS" }], ctx());

    expect(created).toEqual(["CACHE"]);
    expect(res.results.map((r) => [r.binding, r.action])).toEqual([
      ["CACHE", "error"],
      ["SESSIONS", "in-sync"],
    ]);
  });
});

describe("createProvisionedHandler — several entries at once", () => {
  it("walks the ladder per entry and preserves the input order", async () => {
    const { handler, created } = harness({
      list: ok([
        { id: "ns-a", name: "A" },
        { id: "ns-legacy", name: "renamed" },
      ]),
    });
    const entries: Local[] = [{ binding: "A" }, { binding: "B", id: "ns-legacy" }, { binding: "C" }];

    const res = await handler.reconcile(entries, ctx());

    expect(res.results.map((r) => [r.binding, r.action])).toEqual([
      ["A", "in-sync"],
      ["B", "in-sync"],
      ["C", "created"],
    ]);
    expect(created).toEqual(["C"]);
  });
});
