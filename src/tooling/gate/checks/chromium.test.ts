import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";

import { egressProxy, resolveChromiumPath } from "./chromium";

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

// Nothing in this repository calls `egressProxy` — `playwright.config.ts` sets `executablePath`
// alone — so it is published surface with no internal consumer, and the suite is its only caller.
describe("egressProxy", () => {
  const ORIGINAL_PROXY = { upper: process.env.HTTPS_PROXY, lower: process.env.https_proxy };

  function setProxy(upper: string | undefined, lower?: string): void {
    for (const [name, value] of [["HTTPS_PROXY", upper] as const, ["https_proxy", lower] as const]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  afterEach(() => {
    setProxy(ORIGINAL_PROXY.upper, ORIGINAL_PROXY.lower);
  });

  it("returns nothing when no proxy is configured, so playwright is handed no `use.proxy` at all", () => {
    setProxy(undefined);
    expect(egressProxy()).toBeUndefined();
  });

  it("treats an empty value as unset rather than as a proxy at the empty URL", () => {
    setProxy("");
    expect(egressProxy()).toBeUndefined();
  });

  it("builds the server from the configured URL, with the loopback bypass Chromium reads no NO_PROXY for", () => {
    setProxy("http://proxy.internal:3128");
    expect(egressProxy()).toEqual({ server: "http://proxy.internal:3128", bypass: "localhost,127.0.0.1" });
  });

  it("honours a bypass list the caller supplies instead of the loopback default", () => {
    setProxy("http://proxy.internal:3128");
    expect(egressProxy({ bypass: "*.internal" })).toEqual({ server: "http://proxy.internal:3128", bypass: "*.internal" });
  });

  it("falls back to the lowercase spelling, which is the one many tools set", () => {
    setProxy(undefined, "http://lower.internal:3128");
    expect(egressProxy()).toEqual({ server: "http://lower.internal:3128", bypass: "localhost,127.0.0.1" });
  });

  it("prefers the uppercase spelling when both are set", () => {
    setProxy("http://upper.internal:3128", "http://lower.internal:3128");
    expect(egressProxy()?.server).toBe("http://upper.internal:3128");
  });

  it("carries credentials through, decoded, when the URL states them", () => {
    setProxy("http://us%40er:p%40ss@proxy.internal:3128");
    expect(egressProxy()).toEqual({ server: "http://proxy.internal:3128", username: "us@er", password: "p@ss", bypass: "localhost,127.0.0.1" });
  });

  // Playwright treats a present empty `username` as credentials to send, which an unauthenticated
  // proxy answers with a 407 — so the key must be absent rather than empty.
  it("omits the password key entirely when only a username is stated", () => {
    setProxy("http://someone@proxy.internal:3128");
    expect(Object.keys(egressProxy() ?? {})).toEqual(["server", "username", "bypass"]);
  });

  // `new URL` is unguarded, so what a malformed value does is worth pinning rather than discovering
  // during a browser run: a scheme-less host throws, and a bare `host:port` parses as a scheme.
  it("throws on a value `new URL` cannot parse at all", () => {
    setProxy("proxy.internal 3128");
    expect(() => egressProxy()).toThrow(TypeError);
  });

  it("builds an unusable server from a scheme-less `host:port`, which URL parsing accepts as a scheme", () => {
    setProxy("proxy.internal:3128");
    expect(egressProxy()?.server).toBe("proxy.internal://");
  });
});
