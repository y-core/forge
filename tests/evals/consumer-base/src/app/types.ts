import type { Env } from "./env.schema";

/** The Worker's bindings, as `forge cf gen env` reads them from `wrangler.jsonc`. */
export type Bindings = Env;
