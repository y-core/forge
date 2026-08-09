import { hasChromium } from "./lib/browser";

// The gate reads nothing but the exit code, so the whole verdict is this line. `hasChromium`
// accepts the container's baked-in browser as well as playwright's download — see `lib/browser.ts`.
process.exit(hasChromium() ? 0 : 1);
