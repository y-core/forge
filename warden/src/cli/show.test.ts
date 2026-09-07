import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { WARDEN_ROOT } from "../paths";
import { show, SUBJECTS } from "./show";

describe("SUBJECTS", () => {
  it("names a file the installed warden directory actually carries", () => {
    expect(existsSync(join(WARDEN_ROOT, SUBJECTS.zed.file))).toBe(true);
  });
});

describe("show()", () => {
  it("writes the payload to stdout with no trailing newline of its own", () => {
    const written: string[] = [];
    const stdout = process.stdout as unknown as { write: (data: string) => boolean };
    const original = stdout.write;
    stdout.write = (data) => {
      written.push(data);
      return true;
    };
    const errors: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      show("zed");
    } finally {
      stdout.write = original;
      console.error = consoleError;
    }

    expect(written).toEqual([readFileSync(join(WARDEN_ROOT, SUBJECTS.zed.file), "utf-8")]);
    // Every caveat goes to stderr, so a pipe receives the payload alone.
    expect(errors.length).toBeGreaterThan(0);
  });
});
