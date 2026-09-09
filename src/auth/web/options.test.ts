import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import type { AppContext } from "../../context/types";
import { csrfMinterCtx } from "../../form/csrf";
import { authNow, authPasskeyContract, authReturnPath, authSettledPath } from "./options";
import { fakeAuthWebOptions } from "./test-support";

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
