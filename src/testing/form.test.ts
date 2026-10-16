import { describe, expect, it } from "bun:test";

import { importKeyRing } from "../crypto/keyring/ring";
import { FORM_MAX_BYTES_DEFAULT as homeMaxBytes } from "../form/config";
import { CSRF_FIELD_DEFAULT as homeField, CSRF_HEADER_DEFAULT as homeHeader } from "../form/constants";
import { verifyCsrfToken } from "../form/csrf";
import { mintTestCsrfToken as homeMint } from "./csrf";
import { CSRF_FIELD_DEFAULT, CSRF_HEADER_DEFAULT, FORM_MAX_BYTES_DEFAULT, mintTestCsrfToken } from "./form";

const SECRET = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";

describe("testing/form", () => {
  it("re-exports each symbol from its home", () => {
    expect(CSRF_FIELD_DEFAULT).toBe(homeField);
    expect(CSRF_HEADER_DEFAULT).toBe(homeHeader);
    expect(FORM_MAX_BYTES_DEFAULT).toBe(homeMaxBytes);
    expect(mintTestCsrfToken).toBe(homeMint);
  });

  it("mints a token that verifyCsrfToken accepts", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    expect(await verifyCsrfToken(await importKeyRing([SECRET]), token, "/api/contact")).toEqual({ ok: true });
  });
});
