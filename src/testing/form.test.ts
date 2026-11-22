import { describe, expect, it } from "bun:test";

import { importKeyRing } from "../crypto/keyring/ring";
import { FORM_MAX_BYTES_DEFAULT as homeMaxBytes } from "../form/config";
import { CSRF_FIELD_DEFAULT as homeField, CSRF_HEADER_DEFAULT as homeHeader } from "../form/constants";
import { verifyCsrfToken } from "../form/csrf";
import { TURNSTILE_TEST_KEYS as homeTurnstileKeys } from "../form/turnstile-keys";
import { mintTestCsrfToken as homeMint } from "./csrf";
import { CSRF_FIELD_DEFAULT, CSRF_HEADER_DEFAULT, FORM_MAX_BYTES_DEFAULT, mintTestCsrfToken, TURNSTILE_TEST_KEYS } from "./form";
import { TURNSTILE_TEST_KEYS as barrelTurnstileKeys } from "./mod";

const SECRET = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";

describe("testing/form", () => {
  it("re-exports each symbol from its home", () => {
    expect(CSRF_FIELD_DEFAULT).toBe(homeField);
    expect(CSRF_HEADER_DEFAULT).toBe(homeHeader);
    expect(FORM_MAX_BYTES_DEFAULT).toBe(homeMaxBytes);
    expect(mintTestCsrfToken).toBe(homeMint);
    expect(TURNSTILE_TEST_KEYS).toBe(homeTurnstileKeys);
  });

  it("hands the Turnstile test keys out through the testing barrel as the same object", () => {
    expect(barrelTurnstileKeys).toBe(homeTurnstileKeys);
  });

  it("mints a token that verifyCsrfToken accepts", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    expect(await verifyCsrfToken(await importKeyRing([SECRET]), token, "/api/contact")).toEqual({ ok: true });
  });
});
