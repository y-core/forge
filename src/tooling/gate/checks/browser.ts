import type { BrowserEngine } from "./types";

const BROWSER_ENGINES: readonly BrowserEngine[] = ["chromium", "firefox", "webkit"];

/** Whether a Playwright project name is one of the browser engines, rather than a runtime such as `workerd`. @public */
export function isBrowserEngine(name: string): name is BrowserEngine {
  return (BROWSER_ENGINES as readonly string[]).includes(name);
}
