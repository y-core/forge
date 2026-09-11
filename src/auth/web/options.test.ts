import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import type { AppContext } from "../../context/types";
import { csrfMinterCtx } from "../../form/csrf";
import { authNow, authPasskeyContract, authReturnPath, authServices, authSettledPath } from "./options";
import { fakeAuthServices, fakeAuthWebOptions } from "./test-support";

function context(url: string): AppContext {
  const c = new RequestContext(new Request(url));
  csrfMinterCtx.set(c, (path) => Promise.resolve(`csrf-for:${path}`));
  return c as unknown as AppContext;
}

describe("authNow", () => {
  it("reads the injected clock rather than the wall clock", () => {
    expect(authNow(fakeAuthWebOptions({ now: () => 42 }))).toBe(42);
  });
});

// `resolveServices` rebuilds every store, and one request runs a guard, a loader and often an
// action — each of which asked for them separately.
describe("authServices", () => {
  it("builds this request's services once, however many callers ask for them", async () => {
    let calls = 0;
    const options = fakeAuthWebOptions({
      resolveServices: () => {
        calls++;
        return fakeAuthServices();
      },
    });
    const c = context("https://app.example/account/passkeys");

    const first = await authServices(c, options);
    const second = await authServices(c, options);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("memoises the promise, so two parallel callers share one build rather than racing two", async () => {
    let calls = 0;
    const options = fakeAuthWebOptions({
      resolveServices: async () => {
        calls++;
        await Promise.resolve();
        return fakeAuthServices();
      },
    });
    const c = context("https://app.example/account/passkeys");

    const [first, second] = await Promise.all([authServices(c, options), authServices(c, options)]);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("builds again for a second request, since a ceremony is bound to its own session", async () => {
    let calls = 0;
    const options = fakeAuthWebOptions({
      resolveServices: () => {
        calls++;
        return fakeAuthServices();
      },
    });
    await authServices(context("https://app.example/a"), options);
    await authServices(context("https://app.example/b"), options);
    expect(calls).toBe(2);
  });
});

describe("authSettledPath", () => {
  it("falls back to the passkey page when the consumer named none", () => {
    expect(authSettledPath(fakeAuthWebOptions())).toBe("/account/passkeys");
  });

  it("uses the consumer's own landing page when one is named", () => {
    expect(authSettledPath(fakeAuthWebOptions({ settledPath: "/dashboard" }))).toBe("/dashboard");
  });
});

describe("authReturnPath", () => {
  it("takes a same-origin return-to off the query string", () => {
    expect(authReturnPath(context("http://localhost/auth/verify?next=%2Faccount%2Ftotp"), fakeAuthWebOptions())).toBe("/account/totp");
  });

  it("refuses an off-origin return-to and lands on the settled page instead", () => {
    expect(authReturnPath(context("http://localhost/auth/verify?next=https%3A%2F%2Fevil.example"), fakeAuthWebOptions())).toBe("/account/passkeys");
  });

  it("reads the parameter name the consumer configured", () => {
    const options = fakeAuthWebOptions({ returnParam: "back" });
    expect(authReturnPath(context("http://localhost/auth/verify?back=%2Faccount%2Ftotp"), options)).toBe("/account/totp");
  });
});

describe("authPasskeyContract", () => {
  it("mints one token per endpoint, and never the same value for both", async () => {
    const contract = await authPasskeyContract(context("http://localhost/auth/signin"), "authentication", "/begin", "/finish", "/home");

    expect(contract).toEqual({
      mode: "authentication",
      optionsPath: "/begin",
      verifyPath: "/finish",
      optionsToken: "csrf-for:/begin",
      verifyToken: "csrf-for:/finish",
      redirect: "/home",
    });
  });
});
