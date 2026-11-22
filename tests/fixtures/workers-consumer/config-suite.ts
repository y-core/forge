// Reaches `config/types.ts` from a consumer without `exactOptionalPropertyTypes`, directly and through `auth/web`.
import { authNav } from "@y-core/forge/auth/web";
import { createConfig, env } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

export const config = createConfig({ site: { url: env("SITE_URL") } }, v.object({ site: v.object({ url: v.string() }) }));
export const nav = authNav({ signoutPath: "/auth/signout" });
