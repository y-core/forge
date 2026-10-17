import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCfHostConfig } from "./host";

const roots: string[] = [];

function appRoot(source: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "forge-cf-host-"));
  roots.push(root);
  if (source !== null) {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "cf.ts"), source);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("loadCfHostConfig()", () => {
  it("is empty when the app declares no config/cf.ts", async () => {
    expect(await loadCfHostConfig(appRoot(null))).toEqual({});
  });

  it("reads each binding's placement", async () => {
    const root = appRoot('export default { d1: { DB: { jurisdiction: "eu", readReplication: "auto", preview: true } } };\n');
    expect(await loadCfHostConfig(root)).toEqual({ d1: { DB: { jurisdiction: "eu", readReplication: "auto", preview: true } } });
  });

  it("refuses a misspelt key and an unknown jurisdiction by name", async () => {
    await expect(loadCfHostConfig(appRoot('export default { d1: { DB: { jurisdction: "eu" } } };\n'))).rejects.toThrow(
      "config/cf.ts: d1.DB.jurisdction",
    );
    await expect(loadCfHostConfig(appRoot('export default { d1: { DB: { jurisdiction: "uk" } } };\n'))).rejects.toThrow(
      "config/cf.ts: d1.DB.jurisdiction",
    );
  });
});
