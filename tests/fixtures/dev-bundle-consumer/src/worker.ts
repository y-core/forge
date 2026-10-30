// `@y-core/forge/testing` is imported and never used, so it is tree-shaken and must not be reported.
import "@y-core/forge/testing";
import { debugBanner } from "#app/relax";

import { grant } from "./grant.dev";

export default { fetch: () => Response.json({ grant: grant(), banner: debugBanner() ?? null }) };
