/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { get, post, route } from "@remix-run/fetch-router/routes";

import type { Forge } from "../../app/forge-app";
import { buildGuardChain } from "../../app/middleware-chain";
import { getAppContext } from "../../context/types";
import type { AppContext, RequestHandler } from "../../context/types";
import { timingSafeEqual } from "../../crypto/primitives/timing";
import { mintCsrf } from "../../form/csrf";
import { safeRedirectPath } from "../../http/redirect-path";
import { requestLog } from "../../logging/request-logger";
import { sessionCtx } from "../../session/session";
import { APPROVAL_TTL_MS } from "../config";
import { authLimit } from "../limits";
import { readAuthSubmission } from "./actions";
import { approvalCode, signApprovalCode } from "./guards";
import { markApproval } from "./identity";
import { authCsrfHeader, turnstileCheckFor, turnstileWidgetFor } from "./options";
import { APPROVAL_RETURN_PARAM, authWithQuery } from "./paths";
import { createAuthRedirect } from "./redirect";
import { renderAuthDocument } from "./render";
import { approvalSchema } from "./schemas";
import type { Approval, ApprovalOptions } from "./types";
import { ApprovalView } from "./views/approval";

const NO_SESSION =
  "auth/web approval: no session on this request — mount session middleware before `registerApproval`, or an accepted code is recorded nowhere.";

const MIN_APPROVAL_TTL_MS = 1_000;

/** The Turnstile action the prompt's challenge is bound to, so a token solved for an auth form cannot pass it. @internal */
export const APPROVAL_TURNSTILE_ACTION = "approval";

const CODE_REFUSED = "That is not a valid administrator code.";

/** Builds the one administrator approval a deployment's guarded routes and its prompt page share, refusing a window too short to hold. @public */
export function defineApproval<Bindings = Record<string, unknown>>(options: ApprovalOptions<Bindings>): Approval<Bindings> {
  if (options.origin === undefined) {
    throw new Error(
      "defineApproval: no `origin` policy was passed — the prompt answers a POST, so pass one and a cross-site submission to it is refused.",
    );
  }
  if (options.rateLimit === undefined) {
    throw new Error(
      "defineApproval: no `rateLimit` was passed — the prompt is open to anyone and answers guesses at a shared code, so pass a limit; forge picks no numbers.",
    );
  }
  if (options.ring === undefined) {
    throw new Error(
      "defineApproval: no `ring` was passed — a session holds a digest of the code it was approved under, so pass the app's key ring and a changed code ends the approval.",
    );
  }
  const ttlMs = authLimit("defineApproval", "ttlMs", options.ttlMs, {
    fallback: APPROVAL_TTL_MS,
    min: MIN_APPROVAL_TTL_MS,
    unit: "millisecond",
    floor: "a window no approval can be inside makes every approved route prompt forever",
  });
  return Object.freeze({ ...options, ttlMs });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

async function renderPrompt<Bindings>(
  c: AppContext<Bindings>,
  approval: Approval<Bindings>,
  fieldError?: string,
  status?: number,
): Promise<Response> {
  const returnTo = safeRedirectPath(c.url.searchParams.get(APPROVAL_RETURN_PARAM), "");
  const View = approval.view ?? ApprovalView;
  const props = {
    submitPath: returnTo === "" ? approval.path : authWithQuery(approval.path, APPROVAL_RETURN_PARAM, returnTo),
    csrfToken: await mintCsrf(c, approval.path),
    ...authCsrfHeader(c),
    fieldError,
    turnstile: approval.turnstile === undefined ? undefined : await turnstileWidgetFor(c, approval.turnstile, APPROVAL_TURNSTILE_ACTION),
  };
  return renderAuthDocument(c, <View {...props} />, { page: "approval", title: "Administrator approval", status });
}

async function submitPrompt<Bindings>(c: AppContext<Bindings>, approval: Approval<Bindings>): Promise<Response> {
  const expected = approvalCode(c, approval);
  if (expected === undefined) return notFound();
  const session = sessionCtx.get(c, NO_SESSION);

  const check = approval.turnstile === undefined ? undefined : await turnstileCheckFor(c, approval.turnstile, APPROVAL_TURNSTILE_ACTION);
  const parsed = await readAuthSubmission(c, approvalSchema(), check);
  // One refusal for both: telling a failed challenge from a wrong code tells a script which one to solve.
  if (!parsed.ok || !timingSafeEqual(parsed.data.code, expected)) {
    requestLog.getOptional(c)?.warn("auth.approval.refused", { reason: parsed.ok ? "mismatch" : "submission" });
    return renderPrompt(c, approval, CODE_REFUSED, 422);
  }

  markApproval(session, { at: Date.now(), digest: await signApprovalCode(await approval.ring(c), expected) });
  return createAuthRedirect(c, safeRedirectPath(c.url.searchParams.get(APPROVAL_RETURN_PARAM), "/"));
}

/** Mounts `approval`'s prompt page at its path, behind its origin policy and rate limit. @public */
export function registerApproval<Bindings extends object>(app: Forge<Bindings>, approval: Approval<Bindings>): void {
  app.use(approval.path, ...buildGuardChain<Bindings>({ paths: [approval.path], origin: approval.origin, rateLimit: approval.rateLimit }));
  const show: RequestHandler = (context) => {
    const c = getAppContext<Bindings>(context);
    return approvalCode(c, approval) === undefined ? notFound() : renderPrompt(c, approval);
  };
  const submit: RequestHandler = (context) => submitPrompt(getAppContext<Bindings>(context), approval);
  app.map(route({ show: get(approval.path), submit: post(approval.path) }), { actions: { show, submit } });
}
