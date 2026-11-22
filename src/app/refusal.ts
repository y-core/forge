import type { Refusal, RefuseHook } from "../context/types";
import { fragmentResponse, problemResponse } from "../http/response";
import { hxHeaders } from "../render/htmx/htmx-response";
import { isHxRequest } from "../render/htmx/hx-request";
import { jsx } from "../render/jsx/jsx-runtime";
import { renderToString } from "../render/jsx/render-to-string";
import { ANNOUNCE_FAILURE_ATTR } from "../ui/contracts/announcer-contract";
import { FAILURE_FRAGMENT_HEADER } from "../ui/contracts/htmx-contract";
import type { RefuseAsFragmentOptions } from "./types";

const STATUS_PHRASE: Record<Refusal["status"], string> = {
  400: "Bad Request",
  403: "Forbidden",
  413: "Content Too Large",
  429: "Too Many Requests",
  503: "Service Unavailable",
};

/** A refusal hook answering the panel `render` returns as HTML marked for the announcer and as a failure fragment, retargeted under htmx. @public */
export function refuseAsFragment<Bindings = Record<string, unknown>>(options: RefuseAsFragmentOptions<Bindings>): RefuseHook<Bindings> {
  const { target, swap = "innerHTML", render } = options;
  return async (c, refusal) => {
    const { message, panel } = await render(c, refusal);
    const body = await renderToString(jsx("div", { [ANNOUNCE_FAILURE_ATTR]: message, children: panel }));
    const retarget = isHxRequest(c) ? hxHeaders({ retarget: target, reswap: swap }) : {};
    return fragmentResponse(body, refusal.status, { ...retarget, [FAILURE_FRAGMENT_HEADER]: "1" });
  };
}

/** A refusal hook answering RFC 9457 `application/problem+json` with the status and its phrase, never the reason. @public */
export function refuseAsProblem<Bindings = Record<string, unknown>>(): RefuseHook<Bindings> {
  return (_c, refusal) => problemResponse(refusal.status, STATUS_PHRASE[refusal.status]);
}
