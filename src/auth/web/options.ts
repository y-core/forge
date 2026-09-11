import { contextVar } from "../../context/accessor";
import type { AppContext } from "../../context/types";
import { CSRF_HEADER_DEFAULT } from "../../form/constants";
import { mintCsrf } from "../../form/csrf";
import { csrfHeaderCtx } from "../../form/csrf-context";
import { safeRedirectPath } from "../../http/redirect-path";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { EnrollableFactorService } from "../factors/types";
import { PASSKEY_CSRF_HEADER_DEFAULT } from "../passkey-contract";
import type { AuthFactorKind, PasskeyMode } from "../types";
import type { AuthRequestServices, AuthWebOptions } from "./types";
import type { AuthPasskeyContract } from "./views/types";

// One request runs a guard, a loader and often an action, and each called `resolveServices` — which
// rebuilds every store. The promise is memoised rather than the value, so two parallel callers share
// one build rather than racing two. The same shape `authDemandCtx` uses for the same reason.
const authServicesCtx = contextVar<Promise<AuthRequestServices>>("auth.services");

/** This request's services, built once however many times this request asks for them. @internal */
export function authServices<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>): Promise<AuthRequestServices> {
  const held = authServicesCtx.getOptional(c);
  if (held) return held;
  const built = Promise.resolve(options.resolveServices(c));
  authServicesCtx.set(c, built);
  return built;
}

/** This request's clock. @internal */
export function authNow<Bindings>(options: AuthWebOptions<Bindings>): number {
  return options.now === undefined ? Date.now() : options.now();
}

/** Where a request with nothing outstanding is sent. @internal */
export function authSettledPath<Bindings>(options: AuthWebOptions<Bindings>): string {
  return options.settledPath ?? options.paths.account.passkeys();
}

/** The same-origin path this request asked to return to, or the settled one. @internal */
export function authReturnPath<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>): string {
  const asked = c.url.searchParams.get(options.returnParam ?? "next");
  return safeRedirectPath(asked, authSettledPath(options));
}

// Omitted when it is the default, so a deployment that renamed nothing renders byte-identical markup.
/** The header a rendered form must send its token on, absent when `csrfProtection` uses the default. @internal */
export function authCsrfHeader<Bindings>(c: AppContext<Bindings>): { csrfHeader?: string } {
  const csrfHeader = csrfHeaderCtx.getOptional(c);
  return csrfHeader === undefined || csrfHeader === CSRF_HEADER_DEFAULT ? {} : { csrfHeader };
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

/** The enrollable factor `kind` names, or the refusal a deployment not offering it must answer. @internal */
export function authEnrollable(services: AuthRequestServices, kind: AuthFactorKind): Result<EnrollableFactorService, Response> {
  const service = services.factors.find(kind);
  if (service === undefined || service.enrolment !== "explicit") return err(notFound());
  return ok(service);
}

/** Mints the two path-bound tokens a ceremony needs and packs them with the contract the controller reads. @internal */
export async function authPasskeyContract<Bindings>(
  c: AppContext<Bindings>,
  mode: PasskeyMode,
  optionsPath: string,
  verifyPath: string,
  redirect: string,
): Promise<AuthPasskeyContract> {
  const csrfHeader = csrfHeaderCtx.getOptional(c);
  return {
    mode,
    optionsPath,
    verifyPath,
    optionsToken: await mintCsrf(c, optionsPath),
    verifyToken: await mintCsrf(c, verifyPath),
    redirect,
    // Omitted when it matches the controller's own default, so the attribute stays absent in the common case.
    ...(csrfHeader !== undefined && csrfHeader !== PASSKEY_CSRF_HEADER_DEFAULT ? { csrfHeader } : {}),
  };
}
