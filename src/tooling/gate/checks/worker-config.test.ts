import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWorkerConfig } from "./worker-config";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-worker-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readWorkerConfig", () => {
  it("returns the parsed config, comments and trailing commas included", () => {
    writeFileSync(join(root, "wrangler.jsonc"), '{\n  // a comment\n  "name": "app",\n  "assets": { "directory": "./public" },\n}\n');
    expect(readWorkerConfig(root, "wrangler.jsonc", "subject")).toEqual({ config: { name: "app", assets: { directory: "./public" } } });
  });

  it("reports a missing file as not found, under the subject's summary", () => {
    const read = readWorkerConfig(root, "wrangler.jsonc", "subject");
    expect(read).toEqual({
      ok: false,
      findings: [{ level: "fail", message: "`wrangler.jsonc` not found", file: "wrangler.jsonc" }],
      summary: "subject: no worker config",
    });
  });

  it("attaches the caller's remedy to a not-found finding", () => {
    const read = readWorkerConfig(root, "wrangler.jsonc", "subject", ["name the config"]);
    expect("findings" in read ? read.findings[0]?.detail : undefined).toEqual(["name the config"]);
  });

  it("reports malformed JSON as unparseable", () => {
    writeFileSync(join(root, "wrangler.jsonc"), "{ not json");
    const read = readWorkerConfig(root, "wrangler.jsonc", "subject");
    expect("summary" in read ? read.summary : undefined).toBe("subject: unparseable");
    expect("findings" in read ? read.findings[0]?.message.startsWith("`wrangler.jsonc` is not parseable:") : undefined).toBe(true);
  });

  it("reports a config without a string name as unparseable", () => {
    writeFileSync(join(root, "wrangler.jsonc"), '{ "main": "src/worker.ts" }');
    const read = readWorkerConfig(root, "wrangler.jsonc", "subject");
    expect("summary" in read ? [read.ok, read.summary, read.findings.length, read.findings[0]?.file] : undefined).toEqual([
      false,
      "subject: unparseable",
      1,
      "wrangler.jsonc",
    ]);
    expect(
      "findings" in read
        ? read.findings[0]?.message.startsWith(
            `\`wrangler.jsonc\` is not parseable: malformed wrangler config at ${join(root, "wrangler.jsonc")}: name: wrangler config must define a string "name"`,
          )
        : undefined,
    ).toBe(true);
  });
});
