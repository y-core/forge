/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import type { AuthCredential, AuthUser } from "../../types";
import { authPaths } from "../paths";
import { adminRoutes } from "../routes";
import {
  authAdminElevateSchema,
  authAdminUserSchema,
  authEmailChangeSchema,
  authPasskeyLabelSchema,
  authSigninSchema,
  authSignupSchema,
  authTotpEnrolSchema,
  authVerifySchema,
} from "../schemas";
import { valuesOf } from "../test-support";
import { AdminElevateView } from "./admin-elevate";
import { AdminUserEditView } from "./admin-user-edit";
import { EmailChangeView } from "./email-change";
import { PasskeyEditView } from "./passkey-edit";
import { SigninView } from "./signin";
import { SignupView } from "./signup";
import { TotpEnrolView } from "./totp-enrol";
import { VerifyView } from "./verify";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert" | "key" | "mail">;

const CREATED_AT = 1735689600000;

const CREDENTIAL: AuthCredential = {
  id: "c1",
  userId: "u1",
  credentialId: "cid-1",
  publicKey: new Uint8Array(0) as Uint8Array<ArrayBuffer>,
  algorithm: -7,
  signCount: 0,
  transports: [],
  backupEligible: false,
  backedUp: false,
  label: "Work laptop",
  lastUsedAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const ADMIN = authPaths(adminRoutes("/admin"));

const USER: AuthUser = {
  id: "u1",
  email: "ada@example.com",
  emailKey: "ada@example.com",
  emailVerifiedAt: CREATED_AT,
  isAdmin: true,
  deactivatedAt: null,
  sessionsInvalidBefore: null,
  webauthnId: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const TOTP_ENROLLING = {
  status: "enrolling",
  secret: "JBSWY3DPEHPK3PXP",
  uri: "otpauth://totp/Forge:ada@example.com?secret=JBSWY3DPEHPK3PXP",
} as const;

// `admin-users` submits a GET query and carries no CSRF field, `passkey-list` parses against no
// schema, and `passkey-enrol`'s nickname sits outside any form — it travels in the WebAuthn JSON.
/** The name of every field a view submits, and the schema the action parses those fields against. */
const SUBMITTING_VIEWS = [
  {
    view: "SigninView",
    schema: authSigninSchema(),
    html: () =>
      render(<SigninView primaryFactor='email-otp' submitPath='/auth/signin' signupPath='/auth/signup' csrfToken='csrf-1' icon={AppIcon} />),
  },
  {
    view: "SignupView",
    schema: authSignupSchema(),
    html: () => render(<SignupView submitPath='/auth/signup' signinPath='/auth/signin' csrfToken='csrf-1' icon={AppIcon} />),
  },
  {
    view: "VerifyView",
    schema: authVerifySchema(),
    html: () =>
      render(
        <VerifyView
          factor='email-otp'
          submitPath='/auth/verify'
          resendPath='/auth/verify/resend'
          signinPath='/auth/signin'
          csrfToken='csrf-1'
          icon={AppIcon}
        />,
      ),
  },
  {
    view: "EmailChangeView",
    schema: authEmailChangeSchema(),
    html: () =>
      render(
        <EmailChangeView
          currentEmail='ada@example.com'
          submitPath='/account/email-change'
          accountPath='/account/passkeys'
          csrfToken='csrf-1'
          icon={AppIcon}
        />,
      ),
  },
  {
    view: "PasskeyEditView",
    schema: authPasskeyLabelSchema(),
    html: () =>
      render(
        <PasskeyEditView
          credential={CREDENTIAL}
          renamePath='/account/passkeys/c1'
          cancelPath='/account/passkeys'
          csrfToken='csrf-1'
          icon={AppIcon}
        />,
      ),
  },
  {
    view: "TotpEnrolView",
    schema: authTotpEnrolSchema(),
    html: () => render(<TotpEnrolView state={TOTP_ENROLLING} enrolPath='/account/totp' csrfToken='csrf-1' icon={AppIcon} />),
  },
  {
    view: "AdminElevateView",
    schema: authAdminElevateSchema(),
    html: () => render(<AdminElevateView adminCount={0} paths={ADMIN} csrfToken='csrf-1' icon={AppIcon} />),
  },
  {
    view: "AdminUserEditView",
    schema: authAdminUserSchema(),
    html: () =>
      render(<AdminUserEditView user={USER} lastAdmin={false} self={false} outcome={null} paths={ADMIN} csrfToken='csrf-1' icon={AppIcon} />),
  },
] as const;

// Every auth schema is a `strictObject`, so a field the view injects and the action does not drop
// refuses the whole submission. This is the one test that fails the moment a view grows a field.
describe("every auth view submits exactly the fields its schema declares", () => {
  for (const { view, schema, html } of SUBMITTING_VIEWS) {
    it(`${view} submits its schema's fields and the CSRF token, and nothing besides`, async () => {
      const declared = [...Object.keys(schema.entries), "_csrf"].sort();
      expect([...new Set(valuesOf(await html(), "name"))].sort()).toEqual(declared);
    });
  }
});
