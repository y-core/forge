import { describe, expect, it } from "bun:test";

import { createTestContext } from "../testing/context";
import { readTurnstileKey, turnstileVerifyOptions } from "./turnstile";

describe("readTurnstileKey", () => {
  it("reads each key with only its own binding present", async () => {
    const site = createTestContext(new Request("https://app.example/contact"), { env: { TURNSTILE_SITE_KEY: "site-key-public" } });
    const secret = createTestContext(new Request("https://app.example/contact"), { env: { TURNSTILE_SECRET_KEY: "secret-key-private" } });

    expect({ site: await readTurnstileKey(site, "siteKey"), secret: await readTurnstileKey(secret, "secretKey") }).toEqual({
      site: "site-key-public",
      secret: "secret-key-private",
    });
  });

  for (const { name, key, env, message } of [
    {
      name: "an absent site key",
      key: "siteKey" as const,
      env: { TURNSTILE_SECRET_KEY: "secret-key-private" },
      message: "Invalid environment: TURNSTILE_SITE_KEY: missing",
    },
    {
      name: "a blank secret key",
      key: "secretKey" as const,
      env: { TURNSTILE_SITE_KEY: "site-key-public", TURNSTILE_SECRET_KEY: "" },
      message: "Invalid environment: TURNSTILE_SECRET_KEY: missing",
    },
  ]) {
    it(`throws naming only that key for ${name}`, async () => {
      const c = createTestContext(new Request("https://app.example/contact"), { env });

      const thrown = await readTurnstileKey(c, key).catch((error: unknown) => error);

      expect((thrown as Error).message).toBe(message);
    });
  }

  it("lets a sync or an async override win over bindings that carry neither key", async () => {
    const c = createTestContext(new Request("https://app.example/contact"), { env: {} });

    expect({
      sync: await readTurnstileKey(c, "siteKey", () => "override-site"),
      async: await readTurnstileKey(c, "secretKey", async () => "override-secret"),
    }).toEqual({ sync: "override-site", async: "override-secret" });
  });
});

describe("turnstileVerifyOptions", () => {
  it("expects the request's own hostname and sends no remote address when the request carries none", () => {
    const c = createTestContext(new Request("https://www.app.example:8443/contact"));

    expect(turnstileVerifyOptions(c)).toEqual({ expectedHostname: "www.app.example" });
  });

  it("forwards CF-Connecting-IP as the remote address", () => {
    const c = createTestContext(new Request("https://app.example/contact", { headers: { "CF-Connecting-IP": "203.0.113.7" } }));

    expect(turnstileVerifyOptions(c)).toEqual({ expectedHostname: "app.example", remoteIp: "203.0.113.7" });
  });

  it("lets an override win over every default it names", () => {
    const c = createTestContext(new Request("https://app.example/contact", { headers: { "CF-Connecting-IP": "203.0.113.7" } }));

    expect(turnstileVerifyOptions(c, { expectedHostname: "apex.example", remoteIp: "198.51.100.1", expectedAction: "contact" })).toEqual({
      expectedHostname: "apex.example",
      remoteIp: "198.51.100.1",
      expectedAction: "contact",
    });
  });
});
