/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { RequestContext } from "@remix-run/fetch-router";

import { mergeMeta } from "../../app/meta";
import { renderShell } from "../../app/shell";
import type { PageMeta } from "../../app/types";
import { isPartial } from "../../html/htmx/htmx-headers";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { FC } from "../../jsx/types";
import type { AuthPageOptions, AuthViewName, AuthViewProps } from "./types";
import { AdminElevateView } from "./views/admin-elevate";
import { AdminUserEditView } from "./views/admin-user-edit";
import { AdminUsersView } from "./views/admin-users";
import { EmailChangeView } from "./views/email-change";
import { PasskeyEditView } from "./views/passkey-edit";
import { PasskeyEnrolView } from "./views/passkey-enrol";
import { PasskeyListView } from "./views/passkey-list";
import { SigninView } from "./views/signin";
import { SignupView } from "./views/signup";
import { TotpEnrolView } from "./views/totp-enrol";
import { VerifyView } from "./views/verify";

// Keyed by name rather than passed alongside one, so a page cannot be rendered by another page's
// view: the table is what makes `name: "adminUser", view: AdminUsersView` unsayable.
/** Forge's own markup for each page name. @public */
export const AUTH_VIEWS: { readonly [Name in AuthViewName]: FC<AuthViewProps[Name]> } = {
  signin: SigninView,
  signup: SignupView,
  verify: VerifyView,
  enrolPasskey: PasskeyEnrolView,
  enrolTotp: TotpEnrolView,
  accountPasskeys: PasskeyListView,
  accountPasskey: PasskeyListView,
  accountPasskeyEdit: PasskeyEditView,
  accountTotp: TotpEnrolView,
  accountEmailChange: EmailChangeView,
  adminUsers: AdminUsersView,
  adminUser: AdminUserEditView,
  adminUserEdit: AdminUserEditView,
  adminElevate: AdminElevateView,
};

// Forge owns the copy on these pages already — each view renders its own `<h1>` — so it owns the
// title that names the same page in a tab.
/** The document title forge's default shell gives each page. */
const AUTH_PAGE_TITLES: Readonly<Record<AuthViewName, string>> = {
  signin: "Sign in",
  signup: "Create an account",
  verify: "Verify",
  enrolPasskey: "Add a passkey",
  enrolTotp: "Add an authenticator app",
  accountPasskeys: "Passkeys",
  accountPasskey: "Passkeys",
  accountPasskeyEdit: "Rename passkey",
  accountTotp: "Authenticator app",
  accountEmailChange: "Change email",
  adminUsers: "Users",
  adminUser: "User",
  adminUserEdit: "Edit user",
  adminElevate: "Elevate",
};

/** Renders one auth page as a full document or an htmx fragment, honouring a consumer's view override. @public */
export async function renderAuthPage<Name extends AuthViewName>(
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings and params are irrelevant to the medium decision
  c: RequestContext<any, any>,
  options: AuthPageOptions<Name>,
): Promise<Response> {
  const View = options.views?.[options.name] ?? options.view ?? AUTH_VIEWS[options.name];
  const content = <View {...options.props} />;
  const status = options.status ?? 200;

  if (isPartial(c)) {
    return fragmentResponse(await renderToString(content), status, options.headers);
  }

  // Every auth page is `noindex`: a sign-in, an account page and an admin page each say who a
  // deployment's users are, and none of them is a page a search result should land on.
  const own: PageMeta = { title: AUTH_PAGE_TITLES[options.name], robots: "noindex" };
  const slot = { mount: "auth", page: options.name, meta: options.meta === undefined ? own : mergeMeta(own, options.meta) };
  return renderShell(c, content, slot, options.headers === undefined ? { status } : { status, headers: options.headers });
}
