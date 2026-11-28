/** GENERATED — do not edit; run `forge cf gen env`. */

import { v } from "@y-core/forge/validation";

/** The Worker's binding/var surface as a type — inferred from `EnvSchema`. */
export type Env = v.InferOutput<typeof EnvSchema>;

/** The Worker's binding/var surface as a runtime valibot schema. */
export const EnvSchema = v.object({
  DB: v.custom<D1Database>((x) => typeof x === "object" && x !== null, "DB must be a D1 database binding"),
  SITE_NAME: v.string(),
});

declare module "@y-core/forge/config" {
  interface DeclaredEnv extends Env {}
}
