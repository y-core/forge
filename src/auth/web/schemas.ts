import { formDigits, formText, strictObject, v } from "../../validation/mod";
import { AUTH_OTP_DIGITS } from "../config";

/** Longest address the RFC 5321 path allows, so a hostile field cannot become an unbounded read. */
const EMAIL_MAX = 254;

const LABEL_MAX = 64;

/** Digit range RFC 4226 §5.3 permits an authenticator app to emit. */
const TOTP_MIN = 6;
// Eight, which is where `createTotpAppFactor`'s own ceiling is: admitting more would take a code
// the factor will refuse and answer it as a wrong code rather than as a field that is too long.
const TOTP_MAX = 8;

const SEARCH_MAX = 200;

/** The page cursor is a user id, so anything else is a crafted parameter rather than a page. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function emailField() {
  return v.pipe(formText(), v.maxLength(EMAIL_MAX), v.email());
}

/** The sign-in form: the address a primary-factor challenge is sent to. @public */
export function authSigninSchema() {
  return strictObject({ email: emailField() });
}

/** The sign-up form, which carries the same single field as sign-in and is a separate schema so it can diverge. @public */
export function authSignupSchema() {
  return strictObject({ email: emailField() });
}

// The width is the presented factor's own, never a constant: `createEmailOtpFactor({ digits: 8 })`
// is a supported configuration, and a page refusing every correct code of that width is the defect.
/** The verify form: the one-time code the presented factor asks for, separators stripped. @public */
export function authVerifySchema(digits: number = AUTH_OTP_DIGITS) {
  return strictObject({ code: v.pipe(formDigits(), v.length(digits)) });
}

/** The email-change form: the address the change is requested to. @public */
export function authEmailChangeSchema() {
  return strictObject({ email: emailField() });
}

// `formText` trims, so a field holding only spaces arrives as `""`. The domain models an unnamed
// credential as `null`, and folding the two keeps clearing a name from writing a third state.
/** The passkey naming form, used both at enrolment and when renaming a registered credential. @public */
export function authPasskeyLabelSchema() {
  return strictObject({
    label: v.pipe(
      formText(),
      v.maxLength(LABEL_MAX),
      v.transform((label): string | null => (label === "" ? null : label)),
    ),
  });
}

/** The authenticator-app enrolment form: the code proving the shown secret was stored. @public */
export function authTotpEnrolSchema() {
  return strictObject({ code: v.pipe(formDigits(), v.minLength(TOTP_MIN), v.maxLength(TOTP_MAX)) });
}

/** The admin user-edit form: the role and the account status, each a closed choice rather than a checkbox. @public */
export function authAdminUserSchema() {
  return strictObject({ role: v.picklist(["admin", "member"]), status: v.picklist(["active", "deactivated"]) });
}

/** The first-admin elevation form, whose only field is the explicit confirmation. @public */
export function authAdminElevateSchema() {
  return strictObject({ confirm: v.literal("yes") });
}

/** The admin user-list query: a search term and a page cursor, both optional. @public */
export function authAdminSearchSchema() {
  return strictObject({
    q: v.optional(v.pipe(formText(), v.maxLength(SEARCH_MAX))),
    after: v.optional(v.pipe(formText(), v.regex(CANONICAL_UUID))),
  });
}
