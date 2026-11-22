import { describe, expect, it } from "bun:test";

import { TURNSTILE_TEST_KEYS } from "./turnstile-keys";
import { admitsTestingSecret } from "./turnstile.strict";

describe("admitsTestingSecret", () => {
  it("refuses a published testing secret", () => {
    expect(admitsTestingSecret(TURNSTILE_TEST_KEYS.secret.pass)).toBe(false);
  });
});
