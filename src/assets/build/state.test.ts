import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasChanged, loadState, markBuilt, saveState } from "./state";

function makeTmpDir(label: string): string {
  const dir = join(tmpdir(), `forge-state-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadState()", () => {
  it("returns an empty object when the state file does not exist", () => {
    const dir = makeTmpDir("missing");
    try {
      expect(loadState(join(dir, "state.json"))).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty object when the state file is malformed JSON", () => {
    const dir = makeTmpDir("malformed");
    try {
      const statePath = join(dir, "state.json");
      writeFileSync(statePath, "{ not: valid json");
      expect(loadState(statePath)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses a previously written state file", () => {
    const dir = makeTmpDir("parse");
    try {
      const statePath = join(dir, "state.json");
      writeFileSync(statePath, JSON.stringify({ "app.css": "abc123" }));
      expect(loadState(statePath)).toEqual({ "app.css": "abc123" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("saveState() / loadState() round-trip", () => {
  it("persists state that loadState reads back identically", () => {
    const dir = makeTmpDir("roundtrip");
    try {
      const statePath = join(dir, "state.json");
      const state = { "app.css": "hash1", "main.js": "hash2" };
      saveState(statePath, state);
      expect(loadState(statePath)).toEqual(state);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("hasChanged()", () => {
  it("returns true when the key is absent from state", () => {
    expect(hasChanged({}, "app.css", "hash1")).toBe(true);
  });

  it("returns true when the stored hash differs", () => {
    expect(hasChanged({ "app.css": "old" }, "app.css", "new")).toBe(true);
  });

  it("returns false when the stored hash matches", () => {
    expect(hasChanged({ "app.css": "same" }, "app.css", "same")).toBe(false);
  });
});

describe("markBuilt()", () => {
  it("records the hash for the key", () => {
    const state = {};
    markBuilt(state, "app.css", "hash1");
    expect(state).toEqual({ "app.css": "hash1" });
  });

  it("overwrites a prior hash for the same key", () => {
    const state = { "app.css": "old" };
    markBuilt(state, "app.css", "new");
    expect(state).toEqual({ "app.css": "new" });
  });
});

describe("full change-tracking cycle", () => {
  it("transitions hasChanged from true to false after markBuilt + save + reload", () => {
    const dir = makeTmpDir("cycle");
    try {
      const statePath = join(dir, "state.json");
      const state = loadState(statePath);

      // First build: nothing recorded yet.
      expect(hasChanged(state, "app.css", "v1")).toBe(true);
      markBuilt(state, "app.css", "v1");
      saveState(statePath, state);

      // Reload from disk: same hash is now unchanged.
      const reloaded = loadState(statePath);
      expect(hasChanged(reloaded, "app.css", "v1")).toBe(false);

      // A new hash is detected as changed.
      expect(hasChanged(reloaded, "app.css", "v2")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
