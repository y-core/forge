import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gateFixtureRoot } from "./checks/gate.fixture";
import { clearReceipt, readReceipt, receiptCovers, recordReceipt } from "./receipt";
import type { GateReceipt } from "./types";
import { worktreeHash } from "./worktree";
import { worktreeFixture } from "./worktree.fixture";

const TREE = "a".repeat(40);
const OTHER = "b".repeat(40);
const RECEIPT_PATH = ".git/forge-verify-receipt.json";

function receipt(overrides: Partial<GateReceipt> = {}): GateReceipt {
  return { tree: TREE, mode: "standard", labels: ["typecheck", "lint"], ...overrides };
}

function status(root: string): string {
  return spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" }).stdout ?? "";
}

describe("readReceipt()", () => {
  it("is undefined when nothing was recorded", () => {
    expect(readReceipt(worktreeFixture())).toBeUndefined();
  });

  it("is undefined outside a git work tree", () => {
    expect(readReceipt(gateFixtureRoot())).toBeUndefined();
  });

  it("reads back what recordReceipt wrote", () => {
    const root = worktreeFixture();
    recordReceipt(root, receipt());

    expect(readReceipt(root)).toEqual(receipt());
  });

  const malformed: readonly [string, string][] = [
    ["malformed JSON", "{not json"],
    ["an unknown mode", JSON.stringify({ tree: TREE, mode: "release", labels: [] })],
    ["a non-hex tree", JSON.stringify({ tree: "z".repeat(40), mode: "standard", labels: [] })],
    ["a non-array labels", JSON.stringify({ tree: TREE, mode: "standard", labels: "lint" })],
  ];
  for (const [name, contents] of malformed) {
    it(`reads ${name} as no receipt`, () => {
      const root = worktreeFixture();
      writeFileSync(join(root, RECEIPT_PATH), contents);

      expect(readReceipt(root)).toBeUndefined();
    });
  }

  it("accepts a 64-hex tree, as a SHA-256 repository writes", () => {
    const root = worktreeFixture();
    recordReceipt(root, receipt({ tree: "c".repeat(64) }));

    expect(readReceipt(root)?.tree).toBe("c".repeat(64));
  });
});

describe("recordReceipt()", () => {
  it("keeps a higher-mode receipt for the same tree over a lower-mode one", () => {
    const root = worktreeFixture();
    recordReceipt(root, receipt({ mode: "full" }));
    recordReceipt(root, receipt({ mode: "quality" }));

    expect(readReceipt(root)?.mode).toBe("full");
  });

  it("replaces a receipt for a different tree, whatever its mode", () => {
    const root = worktreeFixture();
    recordReceipt(root, receipt({ mode: "full" }));
    recordReceipt(root, receipt({ tree: OTHER, mode: "quality" }));

    expect(readReceipt(root)).toEqual(receipt({ tree: OTHER, mode: "quality" }));
  });

  it("replaces a receipt for the same tree with a higher-mode one", () => {
    const root = worktreeFixture();
    recordReceipt(root, receipt({ mode: "quality" }));
    recordReceipt(root, receipt({ mode: "full" }));

    expect(readReceipt(root)?.mode).toBe("full");
  });

  it("changes neither the tree hash nor git status, since it lives in the git directory", () => {
    const root = worktreeFixture({ "a.txt": "alpha\n" });
    const hash = worktreeHash(root);
    const before = status(root);
    recordReceipt(root, receipt());

    expect(worktreeHash(root)).toBe(hash);
    expect(status(root)).toBe(before);
  });

  it("adds only the receipt to the git directory, leaving no temporary file behind", () => {
    const root = worktreeFixture();
    const before = readdirSync(join(root, ".git"));
    recordReceipt(root, receipt());

    expect(readdirSync(join(root, ".git")).filter((name) => !before.includes(name))).toEqual(["forge-verify-receipt.json"]);
  });

  it("writes nothing outside a git work tree", () => {
    const root = gateFixtureRoot();
    recordReceipt(root, receipt());

    expect(readdirSync(root)).toEqual([]);
  });
});

describe("clearReceipt()", () => {
  it("removes a recorded receipt", () => {
    const root = worktreeFixture();
    recordReceipt(root, receipt());
    clearReceipt(root);

    expect(existsSync(join(root, RECEIPT_PATH))).toBe(false);
  });

  it("does nothing when there is no receipt", () => {
    const root = worktreeFixture();

    expect(() => clearReceipt(root)).not.toThrow();
    expect(() => clearReceipt(gateFixtureRoot())).not.toThrow();
  });
});

describe("receiptCovers()", () => {
  const wanted = { tree: TREE, mode: "standard" as const, labels: ["lint"] };

  it("covers the same tree and mode when the request's labels are a subset", () => {
    expect(receiptCovers(receipt(), wanted)).toBe(true);
  });

  it("lets a full receipt cover a standard request", () => {
    expect(receiptCovers(receipt({ mode: "full" }), wanted)).toBe(true);
  });

  it("refuses a quality receipt for a standard request", () => {
    expect(receiptCovers(receipt({ mode: "quality" }), wanted)).toBe(false);
  });

  it("refuses a different tree", () => {
    expect(receiptCovers(receipt({ tree: OTHER }), wanted)).toBe(false);
  });

  it("refuses when the request selects a label the receipt never ran", () => {
    expect(receiptCovers(receipt(), { ...wanted, labels: ["lint", "test"] })).toBe(false);
  });
});
