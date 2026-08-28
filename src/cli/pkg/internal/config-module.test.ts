import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigModule } from "./config-module";

const ROOT = mkdtempSync(join(tmpdir(), "forge-config-module-"));

function write(name: string, source: string): string {
  writeFileSync(join(ROOT, name), source, "utf-8");
  return name;
}

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const REQUEST = { root: ROOT, explicit: false, what: "step table" };

describe("loadConfigModule()", () => {
  it("returns the default export of a module at a relative path", async () => {
    const path = write("present.ts", "export default [{ label: 'typecheck' }];");

    expect(await loadConfigModule({ ...REQUEST, path })).toEqual([{ label: "typecheck" }]);
  });

  it("accepts an absolute path as readily as a relative one", async () => {
    write("absolute.ts", "export default 'reached';");

    expect(await loadConfigModule({ ...REQUEST, path: join(ROOT, "absolute.ts") })).toBe("reached");
  });

  it("returns undefined for an absent default path, so an optional config stays optional", async () => {
    expect(await loadConfigModule({ ...REQUEST, path: "forge-no-such-config.ts" })).toBeUndefined();
  });

  it("refuses an absent path the caller named, so a typo in --config is never a silent fallback", async () => {
    const request = { ...REQUEST, path: "forge-no-such-config.ts", explicit: true };

    expect(loadConfigModule(request)).rejects.toThrow("No step table at `forge-no-such-config.ts` — --config names a module that does not exist.");
  });

  it("refuses a module that exports everything but a default", async () => {
    const path = write("named-only.ts", "export const STEPS = [];");

    expect(loadConfigModule({ ...REQUEST, path })).rejects.toThrow(
      "`named-only.ts` has no default export — a step table module must `export default` the value it holds.",
    );
  });

  it("names what was being loaded in its errors, so one message serves every bin", async () => {
    const request = { ...REQUEST, path: "forge-no-such-config.ts", explicit: true, what: "release config" };

    expect(loadConfigModule(request)).rejects.toThrow("No release config at");
  });

  it("lets a module's own throw surface rather than reporting it as a missing default", async () => {
    const path = write("throws.ts", "throw new Error('config module is broken');");

    expect(loadConfigModule({ ...REQUEST, path })).rejects.toThrow("config module is broken");
  });
});
