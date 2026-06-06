import { createContextKey } from "@remix-run/fetch-router";

/** Context key that stores the resolved app config for this request. @public */
export const ConfigKey = createContextKey<unknown>();
