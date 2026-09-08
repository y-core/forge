// Generated from src/tooling/gate/checks/chromium.ts by `bun run gen:bundles` — do not edit.

// src/tooling/gate/checks/chromium.ts
import { existsSync } from "node:fs";
function resolveChromiumPath() {
  const fromEnv = process.env.CHROME_PATH;
  return fromEnv && existsSync(fromEnv) ? fromEnv : void 0;
}
export {
  resolveChromiumPath
};
