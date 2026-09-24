import { describe, expect, it } from "bun:test";

import type { CfApiError } from "../../api/types";
import { CfApiClientError } from "../../api/types";
import { failureRows, staleIdDetail } from "./rows";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

const ctxFor = (kind: "worker" | "pages"): HandlerContext => ({
  auth: AUTH,
  scriptName: "my-worker",
  prefix: "",
  dryRun: false,
  rotate: new Set<string>(),
  fetch: () => Promise.reject(new Error("failureRows must not make a request")),
  target: { kind, name: kind === "pages" ? "my-site" : "my-worker" },
});

const cf = (...codes: number[]): CfApiError[] => codes.map((code) => ({ code, message: `upstream ${code}` }));

describe("staleIdDetail", () => {
  it("names the id the account does not have", () => {
    expect(staleIdDetail("ns-deleted")).toBe("local id ns-deleted not found on this account");
  });

  it("says nothing when the config named no id", () => {
    expect(staleIdDetail(undefined)).toBeUndefined();
  });

  it("says nothing for an empty id, which names nothing to report", () => {
    expect(staleIdDetail("")).toBeUndefined();
  });
});

describe("failureRows", () => {
  it("marks a missing target unavailable rather than an error", () => {
    const error = new CfApiClientError("api", "Could not route", { statusCode: 404, cfErrors: cf(7003) });
    expect(failureRows("kv_namespaces", [{ binding: "CACHE" }], error, ctxFor("worker"))).toEqual([
      {
        resourceType: "kv_namespaces",
        binding: "CACHE",
        remoteName: undefined,
        action: "unavailable",
        detail: "worker script · worker script not found: my-worker",
      },
    ]);
  });

  it("marks a rejected token an error, which is the action a missing target must not share", () => {
    const error = new CfApiClientError("api", "Authentication error", { statusCode: 403, cfErrors: cf(10000) });
    expect(failureRows("d1_databases", [{ binding: "DB" }], error, ctxFor("worker"))).toEqual([
      {
        resourceType: "d1_databases",
        binding: "DB",
        remoteName: undefined,
        action: "error",
        detail:
          'worker script · auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change) · code 10000',
      },
    ]);
  });

  it("prefixes the detail with the pages surface it queried", () => {
    const error = new CfApiClientError("network", "fetch failed");
    expect(failureRows("r2_buckets", [{ binding: "BUCKET" }], error, ctxFor("pages"))[0]?.detail).toBe(
      "pages project · network error — fetch failed",
    );
  });

  it("carries the remote name each identity supplied", () => {
    const error = new CfApiClientError("api", "boom", { statusCode: 500 });
    expect(failureRows("queues", [{ binding: "JOBS", remoteName: "proj-jobs" }], error, ctxFor("worker"))).toEqual([
      { resourceType: "queues", binding: "JOBS", remoteName: "proj-jobs", action: "error", detail: "worker script · boom" },
    ]);
  });

  it("emits one row per identity, all sharing the one classification", () => {
    const error = new CfApiClientError("api", "boom", { statusCode: 500 });
    const rows = failureRows("secrets", [{ binding: "A" }, { binding: "B" }, { binding: "C" }], error, ctxFor("worker"));
    expect(rows.map((r) => [r.binding, r.action])).toEqual([
      ["A", "error"],
      ["B", "error"],
      ["C", "error"],
    ]);
  });

  it("emits nothing for an empty identity list", () => {
    expect(failureRows("vars", [], new CfApiClientError("api", "boom"), ctxFor("worker"))).toEqual([]);
  });

  it("withholds the upstream message when the failed request carried a secret", () => {
    const error = new CfApiClientError("api", "value secret=hunter2 is not permitted", { statusCode: 400, cfErrors: cf(1234) });
    expect(failureRows("secrets", [{ binding: "TOKEN" }], error, ctxFor("worker"), { redactMessage: true })[0]?.detail).toBe(
      "worker script · request failed — Cloudflare error 1234 — HTTP 400 (message withheld: it can echo the request body)",
    );
  });

  it("quotes the upstream message when redaction was not asked for", () => {
    const error = new CfApiClientError("api", "Invalid binding name", { statusCode: 400, cfErrors: cf(1234) });
    expect(failureRows("secrets", [{ binding: "TOKEN" }], error, ctxFor("worker"))[0]?.detail).toBe("worker script · Invalid binding name");
  });
});
