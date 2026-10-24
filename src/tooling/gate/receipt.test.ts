import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { worktreeHash } from "../cli/worktree";
import { cloneWorktree, worktreeFixture } from "../cli/worktree.fixture";
import { gateFixtureRoot } from "./checks/gate.fixture";
import { clearReceipt, readReceipt, receiptCovers, recordReceipt } from "./receipt";
import type { GateReceipt } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(...args: Parameters<typeof gateFixtureRoot>): string {
  const root = gateFixtureRoot(...args);
  roots.push(root);
  return root;
}

function worktreeRoot(...args: Parameters<typeof worktreeFixture>): string {
  const root = worktreeFixture(...args);
  roots.push(root);
  return root;
}

const TEMPLATE = worktreeRoot();

function worktreeClone(): string {
  const root = cloneWorktree(TEMPLATE);
  roots.push(root);
  return root;
}

const TREE = "a".repeat(40);
const OTHER = "b".repeat(40);
const RECEIPT_PATH = ".git/forge-verify-receipt.json";

function receipt(overrides: Partial<GateReceipt> = {}): GateReceipt {
  return { tree: TREE, tier: "unit", labels: ["typecheck", "lint"], ...overrides };
}

function status(root: string): string {
  return spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" }).stdout ?? "";
}

describe("readReceipt()", () => {
  it("is undefined when nothing was recorded", () => {
    expect(readReceipt(worktreeClone())).toBeUndefined();
  });

  it("is undefined outside a git work tree", () => {
    expect(readReceipt(fixtureRoot())).toBeUndefined();
  });

  it("reads back what recordReceipt wrote", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt());

    expect(readReceipt(root)).toEqual(receipt());
  });

  const malformed: readonly [string, string][] = [
    ["malformed JSON", "{not json"],
    ["an unknown tier", JSON.stringify({ tree: TREE, tier: "full", labels: [] })],
    ["a receipt written under the retired `mode` key", JSON.stringify({ tree: TREE, mode: "standard", labels: [] })],
    ["a non-hex base", JSON.stringify({ tree: TREE, tier: "runtime", base: "HEAD", labels: [] })],
    ["a non-hex tree", JSON.stringify({ tree: "z".repeat(40), tier: "unit", labels: [] })],
    ["a non-array labels", JSON.stringify({ tree: TREE, tier: "unit", labels: "lint" })],
  ];
  for (const [name, contents] of malformed) {
    it(`reads ${name} as no receipt`, () => {
      const root = worktreeClone();
      writeFileSync(join(root, RECEIPT_PATH), contents);

      expect(readReceipt(root)).toBeUndefined();
    });
  }

  it("reads back the base a runtime receipt was recorded against", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt({ tier: "runtime", base: OTHER }));

    expect(readReceipt(root)).toEqual(receipt({ tier: "runtime", base: OTHER }));
  });

  it("accepts a 64-hex tree, as a SHA-256 repository writes", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt({ tree: "c".repeat(64) }));

    expect(readReceipt(root)?.tree).toBe("c".repeat(64));
  });
});

describe("recordReceipt()", () => {
  it("keeps a higher-tier receipt for the same tree over a lower-tier one", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt({ tier: "release" }));
    recordReceipt(root, receipt({ tier: "static" }));

    expect(readReceipt(root)?.tier).toBe("release");
  });

  it("replaces a receipt for a different tree, whatever its tier", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt({ tier: "release" }));
    recordReceipt(root, receipt({ tree: OTHER, tier: "static" }));

    expect(readReceipt(root)).toEqual(receipt({ tree: OTHER, tier: "static" }));
  });

  it("replaces a receipt for the same tree with a higher-tier one", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt({ tier: "static" }));
    recordReceipt(root, receipt({ tier: "release" }));

    expect(readReceipt(root)?.tier).toBe("release");
  });

  it("changes neither the tree hash nor git status, since it lives in the git directory", () => {
    const root = worktreeRoot({ "a.txt": "alpha\n" });
    const hash = worktreeHash(root);
    const before = status(root);
    recordReceipt(root, receipt());

    expect(worktreeHash(root)).toBe(hash);
    expect(status(root)).toBe(before);
  });

  it("adds only the receipt to the git directory, leaving no temporary file behind", () => {
    const root = worktreeClone();
    const before = readdirSync(join(root, ".git"));
    recordReceipt(root, receipt());

    expect(readdirSync(join(root, ".git")).filter((name) => !before.includes(name))).toEqual(["forge-verify-receipt.json"]);
  });

  it("writes nothing outside a git work tree", () => {
    const root = fixtureRoot();
    recordReceipt(root, receipt());

    expect(readdirSync(root)).toEqual([]);
  });
});

describe("clearReceipt()", () => {
  it("removes a recorded receipt", () => {
    const root = worktreeClone();
    recordReceipt(root, receipt());
    clearReceipt(root);

    expect(existsSync(join(root, RECEIPT_PATH))).toBe(false);
  });

  it("does nothing when there is no receipt", () => {
    const root = worktreeClone();

    expect(() => clearReceipt(root)).not.toThrow();
    expect(() => clearReceipt(fixtureRoot())).not.toThrow();
  });
});

describe("receiptCovers()", () => {
  const wanted = { tree: TREE, tier: "unit" as const, labels: ["lint"] };

  it("covers the same tree and tier when the request's labels are a subset", () => {
    expect(receiptCovers(receipt(), wanted)).toBe(true);
  });

  it("lets a release receipt cover a unit request", () => {
    expect(receiptCovers(receipt({ tier: "release" }), wanted)).toBe(true);
  });

  it("refuses a static receipt for a unit request", () => {
    expect(receiptCovers(receipt({ tier: "static" }), wanted)).toBe(false);
  });

  it("refuses a runtime receipt recorded against another base, since its narrowing read changes against that commit", () => {
    const runtime = { ...wanted, tier: "runtime" as const, base: TREE };

    expect(receiptCovers(receipt({ tier: "runtime", base: TREE }), runtime)).toBe(true);
    expect(receiptCovers(receipt({ tier: "runtime", base: OTHER }), runtime)).toBe(false);
    expect(receiptCovers(receipt({ tier: "runtime" }), runtime)).toBe(false);
  });

  it("ignores the base of a receipt from any other tier, since none of them narrows", () => {
    expect(receiptCovers(receipt({ tier: "deploy", base: OTHER }), { ...wanted, tier: "runtime", base: TREE })).toBe(true);
    expect(receiptCovers(receipt({ tier: "release", base: OTHER }), { ...wanted, tier: "runtime", base: TREE })).toBe(true);
    expect(receiptCovers(receipt({ tier: "release" }), { ...wanted, tier: "runtime", base: TREE })).toBe(true);
    expect(receiptCovers(receipt({ base: OTHER }), { ...wanted, base: TREE })).toBe(true);
  });

  it("refuses a different tree", () => {
    expect(receiptCovers(receipt({ tree: OTHER }), wanted)).toBe(false);
  });

  it("refuses when the request selects a label the receipt never ran", () => {
    expect(receiptCovers(receipt(), { ...wanted, labels: ["lint", "test"] })).toBe(false);
  });
});
