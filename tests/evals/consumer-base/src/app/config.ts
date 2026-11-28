import { createConfig, env } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

/** The app's own settings, read from the validated bindings once per request. */
export const appConfig = createConfig({ siteName: env("SITE_NAME") }, v.object({ siteName: v.pipe(v.string(), v.nonEmpty()) }));

export type AppConfig = ReturnType<typeof appConfig.get>;
