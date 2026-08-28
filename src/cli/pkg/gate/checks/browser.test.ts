import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { hasChromium, resolveChromiumPath } from "./browser";

const ORIGINAL = process.env.CHROME_PATH;

function setChromePath(value: string | undefined): void {
  if (value === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = value;
}

afterEach(() => {
  setChromePath(ORIGINAL);
});

describe("resolveChromiumPath()", () => {
  it("returns nothing when CHROME_PATH is unset", () => {
    setChromePath(undefined);

    expect(resolveChromiumPath()).toBeUndefined();
  });

  it("returns nothing when CHROME_PATH names a file that is not on disk", () => {
    setChromePath("/nonexistent/forge-no-such-chromium");

    expect(resolveChromiumPath()).toBeUndefined();
  });

  it("returns nothing when CHROME_PATH is set but empty, rather than treating it as a path", () => {
    setChromePath("");

    expect(resolveChromiumPath()).toBeUndefined();
  });

  it("returns the path verbatim when CHROME_PATH names one that exists", () => {
    setChromePath("/etc/hostname");

    expect(resolveChromiumPath()).toBe(existsSync("/etc/hostname") ? "/etc/hostname" : undefined);
  });
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

  it("reads a stale or absent download as absent, never as present", () => {
    setChromePath("/nonexistent/forge-no-such-chromium");

    expect(hasChromium()).toBe(existsSync(chromium.executablePath()));
  });
});
