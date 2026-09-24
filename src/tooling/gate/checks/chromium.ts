import { existsSync } from "node:fs";

/** The system Chromium path, if `CHROME_PATH` names one that exists on disk. @public */
export function resolveChromiumPath(): string | undefined {
  // Playwright reads no env var for its own browser path — CHROME_PATH must be joined in here.
  const fromEnv = process.env.CHROME_PATH;
  return fromEnv && existsSync(fromEnv) ? fromEnv : undefined;
}

/** The workspace egress proxy as playwright's `use.proxy`, or `undefined` where none is configured. @public */
export function egressProxy(
  options: { bypass?: string } = {},
): { server: string; username?: string | undefined; password?: string | undefined; bypass: string } | undefined {
  // Chromium reads no `NO_PROXY`, so the bypass list is the only thing keeping the dev server's own
  // origin off the proxy — and a loopback request sent to an egress proxy never arrives.
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (raw === undefined || raw === "") return undefined;
  const url = new URL(raw);
  return {
    server: `${url.protocol}//${url.host}`,
    // Omitted rather than empty: playwright treats a present empty `username` as credentials to
    // send, which an unauthenticated proxy answers with a 407.
    ...(url.username === "" ? {} : { username: decodeURIComponent(url.username) }),
    ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
    bypass: options.bypass ?? "localhost,127.0.0.1",
  };
}
