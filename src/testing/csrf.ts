import { importKeyRing } from "../crypto/keyring/ring";
import { createCsrfToken } from "../form/csrf";
import type { CsrfTokenOptions } from "../form/types";

/** Builds a key ring from `hexSecret` and mints a real, path-bound CSRF token in one call. @public */
export async function mintTestCsrfToken(hexSecret: string, path: string, options?: CsrfTokenOptions): Promise<string> {
  return createCsrfToken(await importKeyRing([hexSecret]), path, options ?? {});
}
