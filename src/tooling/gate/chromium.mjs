// Generated from src/tooling/gate/checks/chromium.ts by `bun run gen:bundles` — do not edit.

// src/tooling/gate/checks/chromium.ts
import { existsSync } from "node:fs";
function resolveChromiumPath() {
  const fromEnv = process.env.CHROME_PATH;
  return fromEnv && existsSync(fromEnv) ? fromEnv : void 0;
}
function egressProxy(options = {}) {
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (raw === void 0 || raw === "") return void 0;
  const url = new URL(raw);
  return {
    server: `${url.protocol}//${url.host}`,
    // Omitted rather than empty: playwright treats a present empty `username` as credentials to
    // send, which an unauthenticated proxy answers with a 407.
    ...url.username === "" ? {} : { username: decodeURIComponent(url.username) },
    ...url.password === "" ? {} : { password: decodeURIComponent(url.password) },
    bypass: options.bypass ?? "localhost,127.0.0.1"
  };
}
export {
  egressProxy,
  resolveChromiumPath
};
