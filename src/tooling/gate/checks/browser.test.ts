import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import { hasChromium } from "./browser";

const ORIGINAL = process.env.CHROME_PATH;

function setChromePath(value: string | undefined): void {
  if (value === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = value;
}

afterEach(() => {
  setChromePath(ORIGINAL);
});

describe("hasChromium()", () => {
  it("accepts a system browser that playwright's own resolution never finds", () => {
    setChromePath("/etc/hostname");
    if (!existsSync("/etc/hostname")) return;

    expect(hasChromium()).toBe(true);
  });

  it("falls back to playwright's own download when CHROME_PATH names nothing", () => {
    setChromePath(undefined);

    expect(hasChromium()).toBe(existsSync(chromium.executablePath()));
  });

  it("loads playwright only on the fallback, so every importer of the gate's step builders skips it", () => {
    const source = readFileSync(join(import.meta.dir, "browser.ts"), "utf-8");

    expect(source.match(/^import\s+(?!type\b)[^;]*from\s+"@playwright\/test"/m)).toBeNull();
  });

  it("reads a stale or absent download as absent, never as present", () => {
    setChromePath("/nonexistent/forge-no-such-chromium");

    expect(hasChromium()).toBe(existsSync(chromium.executablePath()));
  });
});
