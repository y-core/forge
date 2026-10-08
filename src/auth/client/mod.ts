/** Registers the passkey ceremony and site-data scopes forge's auth views stamp; side-effect import before `resume()`. */

import { registerScope } from "../../ui/client/resume";
import { PASSKEY_SCOPE } from "../passkey-contract";
import { SITE_DATA_SCOPE } from "../site-data-contract";
import { mountPasskey } from "./passkey";
import { mountSiteData } from "./site-data";

// Eager because the markup carries no `data-on-*` action of its own: a lazy scope has nothing to
// resume it, and an unsupported browser must be told so before the button is pressed, not after.
registerScope(PASSKEY_SCOPE, { eager: true, setup: ({ root }) => mountPasskey(root) });
registerScope(SITE_DATA_SCOPE, { eager: true, setup: ({ root }) => mountSiteData(root) });
export { onPasskeyPrf } from "./passkey";
export type { PasskeyPrfHandler, PasskeyPrfResult } from "./types";
