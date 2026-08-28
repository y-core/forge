import { describe, expect, it } from "bun:test";
import { suggest } from "./suggest";

const COMMANDS = ["verify", "release", "sync", "assets", "gen-env"];

describe("suggest()", () => {
  it("offers nothing when there is nothing to offer", () => {
    expect(suggest("verify", [])).toBeUndefined();
  });

  it("matches an exact name", () => {
    expect(suggest("sync", COMMANDS)).toBe("sync");
  });

  it("forgives a transposition", () => {
    expect(suggest("vreify", COMMANDS)).toBe("verify");
  });

  it("forgives a dropped letter", () => {
    expect(suggest("verfy", COMMANDS)).toBe("verify");
  });

  it("forgives one edit even in a short name", () => {
    expect(suggest("snc", COMMANDS)).toBe("sync");
  });

  it("ignores case", () => {
    expect(suggest("SYNC", COMMANDS)).toBe("sync");
  });

  it("offers nothing for a word that resembles none of them", () => {
    expect(suggest("deploy", COMMANDS)).toBeUndefined();
  });

  it("does not treat a bare substring as a match, which would name every command containing it", () => {
    // The reference this replaces has a substring fast path, under which `s` matches `assets`,
    // `release` and `sync` alike — three answers being no answer.
    expect(suggest("s", COMMANDS)).toBeUndefined();
  });

  it("returns the closest of several candidates, not the first that clears the threshold", () => {
    expect(suggest("lint", ["lists", "lint-css", "line"])).toBe("line");
  });
});
