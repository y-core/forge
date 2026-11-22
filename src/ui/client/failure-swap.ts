import { FAILURE_FRAGMENT_HEADER } from "../contracts/htmx-contract";

/** Whether a response's swap is suppressed: a 5xx is, unless it carries the failure-fragment marker. @internal */
export function suppressesSwap(status: number, headers: Headers): boolean {
  return status >= 500 && !headers.has(FAILURE_FRAGMENT_HEADER);
}
