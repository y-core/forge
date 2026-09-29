import { HTMX_TRUSTED_TYPES_POLICY } from "../contracts/htmx-contract";
import type { HtmxExtensionHost, HtmxSinkPolicy, TrustedTypesWindow } from "./types";

const SCRIPT_URL_PREFIXES = ["js:", "javascript:"] as const;

/** A policy every htmx sink write fails through, so a refused `forge-htmx` never falls back to an unguarded write. */
const REFUSING_POLICY: HtmxSinkPolicy = {
  createHTML: () => {
    throw new TypeError(`[htmx] the "${HTMX_TRUSTED_TYPES_POLICY}" Trusted Types policy was refused, so htmx may not write HTML`);
  },
  createScript: () => {
    throw new TypeError(`[htmx] the "${HTMX_TRUSTED_TYPES_POLICY}" Trusted Types policy was refused, so htmx may not write a script`);
  },
};

/** Registers the `forge-htmx` extension: a named Trusted Types policy for htmx's sinks, and a refusal of `js:` request URLs. @internal */
export function registerHtmxSecurity(htmx: HtmxExtensionHost, win: TrustedTypesWindow): void {
  const registered = htmx.registerExtension(HTMX_TRUSTED_TYPES_POLICY, {
    init(api) {
      const factory = win.trustedTypes;
      if (!factory) return;
      try {
        api.initSecurity(factory.createPolicy(HTMX_TRUSTED_TYPES_POLICY, { createHTML: (s) => s, createScript: (s) => s }));
      } catch (error) {
        console.error(
          `[htmx] could not create the "${HTMX_TRUSTED_TYPES_POLICY}" Trusted Types policy — list it in the CSP's trusted-types directive; htmx will refuse every swap until then`,
          error,
        );
        api.initSecurity(REFUSING_POLICY);
      }
    },
    htmx_config_request(elt, detail) {
      const action = detail.ctx?.request?.action ?? "";
      if (!SCRIPT_URL_PREFIXES.some((prefix) => action.startsWith(prefix))) return undefined;
      console.error(`[htmx] refused a script request URL on <${elt.localName}>; htmx would evaluate it as JavaScript`, elt);
      return false;
    },
  });
  if (registered === false) {
    console.error(`[htmx] the "${HTMX_TRUSTED_TYPES_POLICY}" extension was not registered — htmx's extensions allowlist must name it`);
  }
}
