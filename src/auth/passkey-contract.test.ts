import { describe, expect, it } from "bun:test";

import {
  PASSKEY,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_REDIRECT_FALLBACK,
  PASSKEY_SCOPE,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "./passkey-contract";

describe("passkey contract — the wire format between a view and a controller that never import each other", () => {
  it("names the scope and every `data-ref` exactly, since drift here is silent at build time", () => {
    expect(PASSKEY_SCOPE).toBe("passkey");
    expect(PASSKEY).toEqual({
      trigger: "passkey-trigger",
      status: "passkey-status",
      unsupported: "passkey-unsupported",
      nickname: "passkey-nickname",
    });
  });

  it("names every configuration attribute exactly", () => {
    expect(PASSKEY_MODE_ATTR).toBe("data-passkey-mode");
    expect(PASSKEY_OPTIONS_PATH_ATTR).toBe("data-passkey-options-path");
    expect(PASSKEY_VERIFY_PATH_ATTR).toBe("data-passkey-verify-path");
    expect(PASSKEY_OPTIONS_TOKEN_ATTR).toBe("data-passkey-options-token");
    expect(PASSKEY_VERIFY_TOKEN_ATTR).toBe("data-passkey-verify-token");
    expect(PASSKEY_REDIRECT_ATTR).toBe("data-passkey-redirect");
  });

  it("keeps the two CSRF tokens on separate attributes, one per endpoint path", () => {
    const tokens = [PASSKEY_OPTIONS_TOKEN_ATTR, PASSKEY_VERIFY_TOKEN_ATTR];
    const paths = [PASSKEY_OPTIONS_PATH_ATTR, PASSKEY_VERIFY_PATH_ATTR];

    expect(new Set(tokens).size).toBe(2);
    expect(new Set([...tokens, ...paths]).size).toBe(4);
  });

  it("names the outcome event and a same-origin fallback for a redirect target it cannot trust", () => {
    expect(PASSKEY_OUTCOME_EVENT).toBe("passkey:outcome");
    expect(PASSKEY_REDIRECT_FALLBACK).toBe("/");
  });
});
