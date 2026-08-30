import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WranglerConfig } from "../../types";
import { GENERATE_MARKER, PUSH_MARKER } from "./devvars";
import { createLocalVarsHandler } from "./localvars";
import type { HandlerContext } from "./types";

function makeProject(devVars: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "foundry-localvars-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(configPath, `{ "name": "proj" }`, "utf-8");
  if (devVars !== null) writeFileSync(join(dir, ".dev.vars"), devVars, "utf-8");
  return configPath;
}

const CTX = {
  auth: { apiToken: "tok", accountId: "acc" },
  scriptName: "worker",
  prefix: "",
  dryRun: true,
  rotate: new Set<string>(),
  fetch: (() => {
    throw new Error("the local-vars handler must not make a request");
  }) as unknown as typeof globalThis.fetch,
  target: { kind: "worker" as const, name: "worker" },
} satisfies HandlerContext;

describe("createLocalVarsHandler().extract()", () => {
  it("takes the unmarked keys and only those", () => {
    const path = makeProject(`LOG_LEVEL=DEBUG\n${PUSH_MARKER}\nSTRIPE_KEY=v\n${GENERATE_MARKER}\nSESSION_SECRET=v\nSCRATCH=1\n`);
    expect(
      createLocalVarsHandler(path)
        .extract({} as WranglerConfig)
        .map((e) => e.name),
    ).toEqual(["LOG_LEVEL", "SCRATCH"]);
  });

  it("excludes a name the config declares as a var", () => {
    // `.dev.vars` shadowing a var is the documented `wrangler dev` pattern; the
    // vars handler reports that one, with the override noted.
    const path = makeProject("BASE_URL=http://localhost:8787\nLOG_LEVEL=DEBUG\n");
    const entries = createLocalVarsHandler(path).extract({ name: "t", vars: { BASE_URL: "https://prod.test" } });
    expect(entries.map((e) => e.name)).toEqual(["LOG_LEVEL"]);
  });

  it("is empty when there is no .dev.vars", () => {
    expect(createLocalVarsHandler(makeProject(null)).extract({} as WranglerConfig)).toEqual([]);
  });
});

describe("createLocalVarsHandler().reconcile()", () => {
  it("reports every key as local only, without making a request", async () => {
    const handler = createLocalVarsHandler(makeProject("LOG_LEVEL=DEBUG\nSCRATCH=1\n"));
    // The context's fetch throws if called, so a passing test is also the proof
    // that this handler needs no credentials.
    const res = await handler.reconcile(handler.extract({} as WranglerConfig), CTX);

    expect(res.results.map((r) => [r.binding, r.action])).toEqual([
      ["LOG_LEVEL", "local-only"],
      ["SCRATCH", "local-only"],
    ]);
  });

  it("claims nothing about the remote, having never looked", () => {
    const handler = createLocalVarsHandler(makeProject("LOG_LEVEL=DEBUG\n"));
    return handler.reconcile(handler.extract({} as WranglerConfig), CTX).then((res) => {
      expect(res.results[0]?.local).toBe(true);
      expect(res.results[0]?.remote).toBeUndefined();
    });
  });

  it("does not opt into reportsEmpty — a project with no local-only keys says nothing", () => {
    expect(createLocalVarsHandler(makeProject(null)).reportsEmpty).toBeUndefined();
  });
});
