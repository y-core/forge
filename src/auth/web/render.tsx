/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { RequestContext } from "@remix-run/fetch-router";

import { type PageMeta, mergeMeta } from "../../app/meta";
import { renderShell } from "../../app/shell";
import { isPartial } from "../../html/htmx/htmx-headers";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { FC } from "../../jsx/types";
import { type AdminElevateViewProps, AdminElevateView } from "./views/admin-elevate";
import { type AdminUserEditViewProps, AdminUserEditView } from "./views/admin-user-edit";
import { type AdminUsersViewProps, AdminUsersView } from "./views/admin-users";
import { type EmailChangeViewProps, EmailChangeView } from "./views/email-change";
import { type PasskeyEditViewProps, PasskeyEditView } from "./views/passkey-edit";
import { type PasskeyEnrolViewProps, PasskeyEnrolView } from "./views/passkey-enrol";
import { type PasskeyListViewProps, PasskeyListView } from "./views/passkey-list";
import { type SigninViewProps, SigninView } from "./views/signin";
import { type SignupViewProps, SignupView } from "./views/signup";
import { type TotpEnrolViewProps, TotpEnrolView } from "./views/totp-enrol";
import { type VerifyViewProps, VerifyView } from "./views/verify";

/** The props each page name's view receives — what a `views` override is held to. @public */
export interface AuthViewProps {
  readonly signin: SigninViewProps;
  readonly signup: SignupViewProps;
  readonly verify: VerifyViewProps;
  readonly enrolPasskey: PasskeyEnrolViewProps;
  readonly enrolTotp: TotpEnrolViewProps;
  readonly accountPasskeys: PasskeyListViewProps;
  readonly accountPasskey: PasskeyListViewProps;
  readonly accountPasskeyEdit: PasskeyEditViewProps;
  readonly accountTotp: TotpEnrolViewProps;
  readonly accountEmailChange: EmailChangeViewProps;
  readonly adminUsers: AdminUsersViewProps;
  readonly adminUser: AdminUserEditViewProps;
  readonly adminUserEdit: AdminUserEditViewProps;
  readonly adminElevate: AdminElevateViewProps;
}

/** Which auth page a render is for — one name per HTML page the route builders serve. @public */
export type AuthViewName = keyof AuthViewProps;

/** Per-page markup a consumer may replace; an entry receives exactly the props forge's own view does. @public */
export type AuthViews = { readonly [Name in AuthViewName]?: FC<AuthViewProps[Name]> };

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

/** What `renderAuthPage` needs to turn one page's data into the medium the request asked for. @public */
export interface AuthPageOptions<Name extends AuthViewName> {
  readonly name: Name;
  /** Markup for this page, ahead of `AUTH_VIEWS` and behind a `views` entry for `name`. */
  readonly view?: FC<AuthViewProps[Name]>;
  readonly props: AuthViewProps[Name];
  readonly views?: AuthViews;
  /** Merged over the descriptor forge gives this page — a title, a canonical, an `og` field. */
  readonly meta?: Partial<PageMeta>;
  readonly status?: number;
  readonly headers?: Record<string, string>;
}

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
