import { createCsrfToken, importCsrfKey } from "../form/csrf";
import type { CsrfTokenOptions } from "../form/types";

/**
 * Imports `hexSecret` and mints a real, path-bound CSRF token in one call — for tests that
 * POST through `csrfProtection` without first performing a `GET` to obtain a token. Uses the
 * production primitives (`importCsrfKey` + `createCsrfToken`), never a mock, so the token
 * verifies against the same secret configured on the middleware.
 *
 * @example
 * ```typescript
 * const token = await mintTestCsrfToken(TEST_CSRF_SECRET, "/api/contact");
 * const res = await app.request("/api/contact", {
 *   method: "POST",
 *   headers: { "content-type": "application/x-www-form-urlencoded" },
 *   body: new URLSearchParams({ _csrf: token, name: "Jane" }),
 * }, TEST_ENV);
 * ```
 * @public
 */
export async function mintTestCsrfToken(hexSecret: string, path: string, options?: CsrfTokenOptions): Promise<string> {
  const key = await importCsrfKey(hexSecret);
  return createCsrfToken(key, path, options ?? {});
}
