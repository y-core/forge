import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WARDEN_ROOT } from "./paths";

/** The installed forge version, which is also the canon's version: a forge bump is the only way the
 *  canon changes in a consumer, so stamping it into the index invalidates the canon half
 *  automatically and needs no second version to keep in step. @public */
export function canonVersion(): string {
  const manifest = resolve(WARDEN_ROOT, "..", "package.json");
  if (!existsSync(manifest)) return "unknown";
  try {
    return (JSON.parse(readFileSync(manifest, "utf-8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
