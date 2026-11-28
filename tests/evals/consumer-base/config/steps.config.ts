import { fileURLToPath } from "node:url";

import { cloudflareWorkerSteps, defineSteps, mergeTiers } from "@y-core/forge/tooling/gate";
import { wardenAppSteps } from "@y-core/forge/warden/steps";

import pkg from "../package.json" with { type: "json" };
import { QUERIES } from "./warden-queries";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineSteps({
  tiers: mergeTiers(
    cloudflareWorkerSteps({ root: ROOT, workerConfig: "wrangler.jsonc", db: true, warden: true }),
    wardenAppSteps({ root: ROOT, packageName: pkg.name, queries: QUERIES }),
  ),
});
