import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../../context/accessor";
import { getAppContext } from "../../context/types";
import { assertUnwrappedKeyRing, createKeyRingResolver } from "../../crypto/keyring/resolver";
import { requestLog } from "../../logging/request-logger";
import { verifySignedObjectUrl } from "./signing";
import type { SignedObjectLinkOptions, SignedUrlFailure } from "./types";

/** Typed accessor for the object key `signedObjectLink` verified on this request. @public */
export const signedObjectKey = contextVar<string>("signedObjectKey");

/** Middleware that admits only a valid signed object URL and exposes its verified key through `signedObjectKey`. @public */
export function signedObjectLink<Bindings = Record<string, unknown>>(options: SignedObjectLinkOptions<Bindings>): Middleware {
  assertUnwrappedKeyRing("signedObjectLink", options.ring);
  const resolveRing = createKeyRingResolver(options.ring);
  const refuse = (context: RequestContext, reason: SignedUrlFailure): Response | Promise<Response> => {
    requestLog.getOptional(context)?.warn("storage.signed-link.refused", { reason });
    return options.onRefuse ? options.onRefuse(getAppContext<Bindings>(context), reason) : new Response("Forbidden", { status: 403 });
  };
  return async (context, next) => {
    const ring = await resolveRing(context);
    const verdict = await verifySignedObjectUrl(ring, context.request.url);
    if (!verdict.ok) return refuse(context, verdict.error);
    signedObjectKey.set(context, verdict.data);
    return next();
  };
}
