import { createCsrfToken, importCsrfKey } from "../form/csrf";
import type { CsrfTokenOptions } from "../form/types";

/** Imports `hexSecret` and mints a real, path-bound CSRF token in one call. @public */
export async function mintTestCsrfToken(hexSecret: string, path: string, options?: CsrfTokenOptions): Promise<string> {
  const key = await importCsrfKey(hexSecret);
  return createCsrfToken(key, path, options ?? {});
}
