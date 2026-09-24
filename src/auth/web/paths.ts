import { Route } from "@remix-run/fetch-router/routes";
import type { RouteMap } from "@remix-run/fetch-router/routes";

import type { AuthFactorKind } from "../types";
import type { AuthEntryPaths, AuthPathMap } from "./types";

// A bare flag and never the outcome: it records that the visitor pressed the control, which they
// already know, so it is safe on a URL a shoulder or a log can read.
/** The query flag the resend action redirects with, so the verify page can say a code was asked for. @internal */
export const AUTH_RESENT_PARAM = "resent";

/** Binds one route's `href` so the mount point stays the route map's and never the caller's. */
function bindHref(leaf: Route): (...args: Parameters<Route["href"]>) => string {
  return (...args) => leaf.href(...args);
}

/** Reads every href back off a built route map, so no path literal is written twice. @public */
export function authPaths<routes extends RouteMap>(routeMap: routes): AuthPathMap<routes> {
  const paths: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(routeMap)) {
    paths[name] = value instanceof Route ? bindHref(value) : authPaths(value);
  }
  return paths as AuthPathMap<routes>;
}

// Total over the kinds a user enrols in deliberately — email-OTP's enrolment is a verified address
// and has no page — so a chain wired from this cannot own an enrolment it has nowhere to send.
/** Every enrolment page `authRoutes` mounts, keyed by the factor kind it enrols. @public */
export function authEnrolmentPaths(paths: AuthEntryPaths): Partial<Record<AuthFactorKind, string>> {
  return { passkey: paths.enrol.passkey(), "totp-app": paths.enrol.totp() };
}

/** The first of `kinds` that `enrolmentPaths` names a page for, or `undefined` when it names none. @internal */
export function authEnrolTarget(enrolmentPaths: Partial<Record<AuthFactorKind, string>>, kinds: readonly AuthFactorKind[]): string | undefined {
  for (const kind of kinds) {
    const path = enrolmentPaths[kind];
    if (path !== undefined) return path;
  }
  return undefined;
}
