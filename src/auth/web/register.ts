import type { Forge } from "../../app/forge-app";
import { getAppContext } from "../../context/types";
import type { AppContext, RequestHandler } from "../../context/types";
import {
  createAdminElevateActions,
  createAdminUserActions,
  createEmailChangeActions,
  createPasskeyEnrolActions,
  createPasskeyManageActions,
  createPasskeySigninActions,
  createPasskeyStepUpActions,
  createSigninActions,
  createSignoutActions,
  createSignupActions,
  createTotpEnrolActions,
  createTotpManageActions,
  createVerifyActions,
} from "./actions";
import {
  loadAdminElevate,
  loadAdminUser,
  loadAdminUserEdit,
  loadAdminUsers,
  loadEmailChange,
  loadEnrolTotp,
  loadPasskey,
  loadPasskeyEdit,
  loadPasskeyEnrol,
  loadPasskeyList,
  loadSignin,
  loadSignup,
  loadTotpEnrol,
  loadVerify,
} from "./loaders";
import type { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthWebOptions } from "./types";

/** One page loader as the router's handler, narrowed to the app context the loader reads. */
function authPage<Bindings>(
  load: (c: AppContext<Bindings>, options: AuthWebOptions<Bindings>) => Promise<Response>,
  options: AuthWebOptions<Bindings>,
): RequestHandler {
  return (context) => load(getAppContext<Bindings>(context), options);
}

// One `app.map` per group of `AUTH_ROUTE_GROUPS`, because a controller must supply every leaf at
// its own level: the group cut and the controller cut are the same cut.
/** Mounts the sign-in, sign-up, verification and passkey-enrolment routes on `app`. @public */
export function registerAuth<Bindings extends object>(
  app: Forge<Bindings>,
  routes: ReturnType<typeof authRoutes<string>>,
  options: AuthWebOptions<Bindings>,
): void {
  app.map(routes, {
    actions: {
      signin: authPage(loadSignin, options),
      signup: authPage(loadSignup, options),
      ...createSigninActions(options),
      ...createSignupActions(options),
      ...createSignoutActions(options),
    },
  });
  app.map(routes.passkey, { actions: { ...createPasskeySigninActions(options) } });
  app.map(routes.verify, { actions: { show: authPage(loadVerify, options), ...createVerifyActions(options) } });
  app.map(routes.verify.ceremony, { actions: { ...createPasskeyStepUpActions(options) } });
  app.map(routes.enrol, {
    actions: { passkey: authPage(loadPasskeyEnrol, options), totp: authPage(loadEnrolTotp, options), ...createTotpEnrolActions(options) },
  });
  app.map(routes.enrol.ceremony, { actions: { ...createPasskeyEnrolActions(options) } });
}

/** Mounts the signed-in self-service routes — passkeys, authenticator app and email change — on `app`. @public */
export function registerAccount<Bindings extends object>(
  app: Forge<Bindings>,
  routes: ReturnType<typeof accountRoutes<string>>,
  options: AuthWebOptions<Bindings>,
): void {
  app.map(routes, {
    actions: {
      passkeys: authPage(loadPasskeyList, options),
      passkey: authPage(loadPasskey, options),
      passkeyEdit: authPage(loadPasskeyEdit, options),
      totp: authPage(loadTotpEnrol, options),
      emailChange: authPage(loadEmailChange, options),
      ...createPasskeyManageActions(options),
      ...createTotpManageActions(options),
      ...createEmailChangeActions(options),
    },
  });
}

/** Mounts the administrative user routes and the deliberately not admin-gated elevation routes on `app`. @public */
export function registerAdmin<Bindings extends object>(
  app: Forge<Bindings>,
  routes: ReturnType<typeof adminRoutes<string>>,
  options: AuthWebOptions<Bindings>,
): void {
  app.map(routes.users, {
    actions: {
      list: authPage(loadAdminUsers, options),
      show: authPage(loadAdminUser, options),
      edit: authPage(loadAdminUserEdit, options),
      ...createAdminUserActions(options),
    },
  });
  app.map(routes.elevate, { actions: { show: authPage(loadAdminElevate, options), ...createAdminElevateActions(options) } });
}
