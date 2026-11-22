/** The Trusted Types policy `ui/client/htmx` creates for htmx's sinks, and the htmx extension name it registers; list it in the CSP's `trusted-types`. @public */
export const HTMX_TRUSTED_TYPES_POLICY = "forge-htmx";

/** The response header marking a failure fragment written to be swapped, so `ui/client/htmx` swaps it even at a 5xx. @public */
export const FAILURE_FRAGMENT_HEADER = "Forge-Failure-Fragment";
