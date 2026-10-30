import { isDevBuildArmed, whenArmed } from "@y-core/forge/relax";

import { debugBanner as strictDebugBanner } from "./relax.strict";

export const developmentBanner = (): string => "development build";

export const debugBanner: typeof strictDebugBanner = whenArmed(isDevBuildArmed, developmentBanner, strictDebugBanner);
