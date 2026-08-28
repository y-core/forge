import { describe, expect, it } from "bun:test";
import { tokenize } from "./tokenize";

describe("tokenize()", () => {
  it("returns nothing for an empty command line", () => {
    expect(tokenize([])).toEqual([]);
  });

  it("classifies a bare word as a positional", () => {
    expect(tokenize(["build"])).toEqual([{ kind: "positional", index: 0, value: "build" }]);
  });

  it("classifies a long flag", () => {
    expect(tokenize(["--force"])).toEqual([{ kind: "option", index: 0, name: "force", raw: "--force" }]);
  });

  it("splits a long flag's inline value", () => {
    expect(tokenize(["--config=a.json"])).toEqual([{ kind: "option", index: 0, name: "config", raw: "--config", value: "a.json", inline: true }]);
  });

  it("keeps an equals sign inside an inline value", () => {
    expect(tokenize(["--set=a=b"])[0]).toEqual({ kind: "option", index: 0, name: "set", raw: "--set", value: "a=b", inline: true });
  });

  it("classifies a short flag", () => {
    expect(tokenize(["-c"])).toEqual([{ kind: "option", index: 0, name: "c", raw: "-c" }]);
  });

  it("expands a short cluster, every member carrying the index of the one element it came from", () => {
    expect(tokenize(["-abc"])).toEqual([
      { kind: "option", index: 0, name: "a", raw: "-a" },
      { kind: "option", index: 0, name: "b", raw: "-b" },
      { kind: "option", index: 0, name: "c", raw: "-c" },
    ]);
  });

  it("gives a cluster's inline value to its last member", () => {
    expect(tokenize(["-ab=cd"])).toEqual([
      { kind: "option", index: 0, name: "a", raw: "-a" },
      { kind: "option", index: 0, name: "b", raw: "-b", value: "cd", inline: true },
    ]);
  });

  it("reads a lone hyphen as a positional", () => {
    expect(tokenize(["-"])).toEqual([{ kind: "positional", index: 0, value: "-" }]);
  });

  it("reads a negative integer as a value, not a cluster", () => {
    expect(tokenize(["-12"])).toEqual([{ kind: "positional", index: 0, value: "-12" }]);
  });

  it("reads a negative decimal as a value", () => {
    expect(tokenize(["-1.5"])).toEqual([{ kind: "positional", index: 0, value: "-1.5" }]);
  });

  it("marks the terminator and makes everything after it positional", () => {
    expect(tokenize(["--force", "--", "--not-a-flag", "-x"])).toEqual([
      { kind: "option", index: 0, name: "force", raw: "--force" },
      { kind: "option-terminator", index: 1 },
      { kind: "positional", index: 2, value: "--not-a-flag" },
      { kind: "positional", index: 3, value: "-x" },
    ]);
  });

  it("indexes into argv, so slicing from a token's index is the rest of the command line", () => {
    const argv = ["run", "-ab", "--only", "lint"];
    const only = tokenize(argv).find((t) => t.name === "only");
    expect(argv.slice(only?.index ?? -1)).toEqual(["--only", "lint"]);
  });
});
