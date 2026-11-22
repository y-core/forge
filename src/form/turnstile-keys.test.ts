import { describe, expect, it } from "bun:test";

import { TURNSTILE_TEST_KEYS } from "./turnstile-keys";

describe("TURNSTILE_TEST_KEYS", () => {
  it("carries Cloudflare's published testing keys and dummy token, by outcome", () => {
    expect(TURNSTILE_TEST_KEYS).toEqual({
      site: {
        pass: "1x00000000000000000000AA",
        block: "2x00000000000000000000AB",
        invisible: "1x00000000000000000000BB",
        interactive: "3x00000000000000000000FF",
      },
      secret: {
        pass: "1x0000000000000000000000000000000AA",
        fail: "2x0000000000000000000000000000000AA",
        spent: "3x0000000000000000000000000000000AA",
      },
      token: "XXXX.DUMMY.TOKEN.XXXX",
    });
  });

  it("is frozen at every level, so a test cannot rewrite a key another test reads", () => {
    expect([Object.isFrozen(TURNSTILE_TEST_KEYS), Object.isFrozen(TURNSTILE_TEST_KEYS.site), Object.isFrozen(TURNSTILE_TEST_KEYS.secret)]).toEqual([
      true,
      true,
      true,
    ]);
  });
});
