import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { trimScripts } from "./scripts";

const PACKAGE = '{\n  "name": "app",\n  "scripts": {\n    "a": "one",\n    "b": "two",\n    "c": "three"\n  },\n  "private": true\n}\n';
const NOT_ONE_PER_LINE = new CliError(
  "invalid-args",
  "package.json's scripts are not one entry per line — forge curate removes a script by removing its line",
);

describe("trimScripts()", () => {
  it("removes a middle entry's line and leaves every other byte", () => {
    expect(trimScripts(PACKAGE, ["b"])).toBe(
      '{\n  "name": "app",\n  "scripts": {\n    "a": "one",\n    "c": "three"\n  },\n  "private": true\n}\n',
    );
  });

  it("removes the last entry and the comma the new last entry would otherwise keep", () => {
    expect(trimScripts(PACKAGE, ["c"])).toBe('{\n  "name": "app",\n  "scripts": {\n    "a": "one",\n    "b": "two"\n  },\n  "private": true\n}\n');
  });

  it("removes every entry, leaving the block open and closed", () => {
    expect(trimScripts(PACKAGE, ["a", "b", "c"])).toBe('{\n  "name": "app",\n  "scripts": {\n  },\n  "private": true\n}\n');
  });

  it("reads an escaped quote in a key as part of the name", () => {
    const text = '{\n  "scripts": {\n    "say \\"hi\\"": "echo",\n    "b": "two"\n  }\n}\n';
    expect(trimScripts(text, ['say "hi"'])).toBe('{\n  "scripts": {\n    "b": "two"\n  }\n}\n');
  });

  it("refuses scripts written on one line", () => {
    expect(() => trimScripts('{ "scripts": { "a": "one", "b": "two" } }\n', ["a"])).toThrow(NOT_ONE_PER_LINE);
  });

  it("refuses an entry whose value continues onto the next line", () => {
    const text = '{\n  "scripts": {\n    "a":\n      "one",\n    "b": "two"\n  }\n}\n';
    expect(() => trimScripts(text, ["a"])).toThrow(NOT_ONE_PER_LINE);
  });
});
