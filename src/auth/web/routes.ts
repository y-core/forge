import { del, get, patch, post, route } from "@remix-run/fetch-router/routes";

import type { AuthRouteGroup } from "./types";

/** Every group the three builders produce — a nested group exists only where its guards or medium differ from its parent's. @public */
export const AUTH_ROUTE_GROUPS: readonly AuthRouteGroup[] = [
  { path: ["auth"], guards: [], medium: "html" },
  { path: ["auth", "passkey"], guards: [], medium: "json" },
  // The one group that admits both an anonymous visitor and a signed-in one: the page serves the
  // second half of a sign-in and a step-up owed by a session, and only the identity tells them apart.
  { path: ["auth", "verify"], guards: ["resolve-auth"], medium: "html" },
  { path: ["auth", "verify", "ceremony"], guards: ["require-auth"], medium: "json" },
  { path: ["auth", "enrol"], guards: ["require-auth", "require-pending-enrolment"], medium: "html" },
  { path: ["auth", "enrol", "ceremony"], guards: ["require-auth", "require-pending-enrolment"], medium: "json" },
  { path: ["account"], guards: ["require-auth", "require-enrolment", "require-fresh-step-up"], medium: "html" },
  { path: ["admin"], guards: [], medium: "html" },
  { path: ["admin", "users"], guards: ["require-auth", "require-enrolment", "require-admin"], medium: "html" },
  { path: ["admin", "elevate"], guards: ["require-auth", "require-enrolment", "require-fresh-step-up"], medium: "html" },
];

/** Builds the unauthenticated sign-in, sign-up and enrolment routes under `basePath`. @public */
export function authRoutes<base extends string>(basePath: base) {
  return route(basePath, {
    signin: get("/signin"),
    signinSubmit: post("/signin"),
    signup: get("/signup"),
    signupSubmit: post("/signup"),
    signout: post("/signout"),
    passkey: { authenticateBegin: post("/passkey/authenticate/begin"), authenticateFinish: post("/passkey/authenticate/finish") },
    verify: {
      show: get("/verify"),
      submit: post("/verify"),
      resend: post("/verify/resend"),
      // A step-up of its own, never the discoverable sign-in pair above: those establish a session,
      // which clears the very mark a step-up is there to write.
      ceremony: { begin: post("/verify/passkey/begin"), finish: post("/verify/passkey/finish") },
    },
    enrol: {
      passkey: get("/enrol/passkey"),
      totp: get("/enrol/totp"),
      totpEnrol: post("/enrol/totp"),
      ceremony: { begin: post("/enrol/passkey/register/begin"), finish: post("/enrol/passkey/register/finish") },
    },
  });
}

/** Builds the signed-in self-service routes — passkey management and email change — under `basePath`. @public */
export function accountRoutes<base extends string>(basePath: base) {
  return route(basePath, {
    passkeys: get("/passkeys"),
    passkey: get("/passkeys/:id"),
    passkeyEdit: get("/passkeys/:id/edit"),
    passkeyRename: patch("/passkeys/:id"),
    passkeyRemove: del("/passkeys/:id"),
    totp: get("/totp"),
    totpEnrol: post("/totp"),
    totpRemove: del("/totp"),
    emailChange: get("/email-change"),
    emailChangeSubmit: post("/email-change"),
  });
}

/** Builds the admin user-management routes and the deliberately not admin-gated elevation routes under `basePath`. @public */
export function adminRoutes<base extends string>(basePath: base) {
  return route(basePath, {
    users: { list: get("/users"), show: get("/users/:id"), edit: get("/users/:id/edit"), update: patch("/users/:id"), remove: del("/users/:id") },
    elevate: { show: get("/elevate"), submit: post("/elevate") },
  });
}
