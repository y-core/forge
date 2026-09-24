// Three deliberate crossings, one per rule: this file is deployed, imports the development entry,
// and reaches a dev-only subpath whose fakes lose every write in a real deployment.
import { fakeKV } from "@y-core/forge/testing";

import { devOnly } from "./worker.dev";

export default { fetch: () => new Response(devOnly(fakeKV())) };
