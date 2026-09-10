import type { AppContext } from "../../context/types";
import { renderAuthPage } from "./render";
import { AUTH_VIEW_GUARDS, resolveAuthView } from "./resolve";
import type { AuthPageState, AuthWebOptions } from "./types";
import type { AuthViewName } from "./types";
import type { AuthViewRequest } from "./types";

/** Resolves one page against this request and renders it, or answers the refusal the resolver gave. */
async function authPage<Name extends AuthViewName, Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  request: AuthViewRequest<Name>,
): Promise<Response> {
  const resolved = await resolveAuthView(c, options, request);
  if (!resolved.ok) return resolved.error;
  const { views } = options;
  const { props, status } = resolved.data;
  return renderAuthPage(c, { name: request.name, props, ...(views === undefined ? {} : { views }), ...(status === undefined ? {} : { status }) });
}

/** The sign-in page, whose primary affordance is whichever factor the deployment made primary. @public */
export function loadSignin<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "signin", state, guarded: AUTH_VIEW_GUARDS.signin });
}

/** The sign-up page — one address field, whatever factors the deployment offers. @public */
export function loadSignup<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "signup", state, guarded: AUTH_VIEW_GUARDS.signup });
}

/** The verification page, whose affordance is the code field or a ceremony, per the factor. @public */
export function loadVerify<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "verify", state, guarded: AUTH_VIEW_GUARDS.verify });
}

/** The page a visitor lands on when the factor policy says they still owe an enrolment. @public */
export function loadPasskeyEnrol<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState = {},
): Promise<Response> {
  return authPage(c, options, { name: "enrolPasskey", state, guarded: AUTH_VIEW_GUARDS.enrolPasskey });
}

/** The authenticator-app page a visitor owing that enrolment lands on, outside the account group the enrolment guard closes. @public */
export function loadEnrolTotp<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "enrolTotp", state, guarded: AUTH_VIEW_GUARDS.enrolTotp });
}

/** The visitor's registered passkeys, each with its rename and remove affordances. @public */
export function loadPasskeyList<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState = {},
): Promise<Response> {
  return authPage(c, options, { name: "accountPasskeys", state, guarded: AUTH_VIEW_GUARDS.accountPasskeys });
}

/** One registered passkey on its own, which is what an htmx row refresh asks for. @public */
export function loadPasskey<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "accountPasskey", state, guarded: AUTH_VIEW_GUARDS.accountPasskey });
}

/** The rename page for one registered passkey. @public */
export function loadPasskeyEdit<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState = {},
): Promise<Response> {
  return authPage(c, options, { name: "accountPasskeyEdit", state, guarded: AUTH_VIEW_GUARDS.accountPasskeyEdit });
}

/** The authenticator-app page: the once-only secret and its confirmation, or the settled enrolment. @public */
export function loadTotpEnrol<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "accountTotp", state, guarded: AUTH_VIEW_GUARDS.accountTotp });
}

/** The email-change page: request a change, then wait for the confirmation to be clicked. @public */
export function loadEmailChange<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState = {},
): Promise<Response> {
  return authPage(c, options, { name: "accountEmailChange", state, guarded: AUTH_VIEW_GUARDS.accountEmailChange });
}

/** The administrative user listing, with its search form and its forward cursor. @public */
export function loadAdminUsers<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "adminUsers", state, guarded: AUTH_VIEW_GUARDS.adminUsers });
}

/** One account as an administrator sees it. @public */
export function loadAdminUser<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>, state: AuthPageState = {}): Promise<Response> {
  return authPage(c, options, { name: "adminUser", state, guarded: AUTH_VIEW_GUARDS.adminUser });
}

/** One account's role, status and deletion controls. @public */
export function loadAdminUserEdit<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState = {},
): Promise<Response> {
  return authPage(c, options, { name: "adminUserEdit", state, guarded: AUTH_VIEW_GUARDS.adminUserEdit });
}

/** The first-admin claim: one explicit confirmation, disabled with its reason once an admin exists. @public */
export function loadAdminElevate<Bindings>(
  c: AppContext<Bindings>,
  options: AuthWebOptions<Bindings>,
  state: AuthPageState = {},
): Promise<Response> {
  return authPage(c, options, { name: "adminElevate", state, guarded: AUTH_VIEW_GUARDS.adminElevate });
}
