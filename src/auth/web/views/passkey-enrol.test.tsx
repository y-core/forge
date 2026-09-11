/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_SCOPE,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../../passkey-contract";
import {
  attrOf,
  attrsOf,
  authFactorGrid,
  elementOf,
  factorDemand,
  HOSTILE_TEXT,
  HOSTILE_TEXT_ESCAPED,
  tagOf,
  textOf,
  valuesOf,
} from "../test-support";
import { PasskeyEnrolView } from "./passkey-enrol";
import type { AuthPasskeyContract, PasskeyEnrolViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert" | "key">;

const CONTRACT: AuthPasskeyContract = {
  mode: "registration",
  optionsPath: "/auth/enrol/passkey/register/begin",
  verifyPath: "/auth/enrol/passkey/register/finish",
  optionsToken: "opt-tok",
  verifyToken: "ver-tok",
};

function enrol(props: Partial<PasskeyEnrolViewProps> = {}) {
  return render(
    <PasskeyEnrolView
      contract={CONTRACT}
      signoutPath='/auth/signout'
      signoutCsrfToken='csrf-signout'
      email='ada@example.com'
      icon={AppIcon}
      {...props}
    />,
  );
}

describe("PasskeyEnrolView contract attributes", () => {
  it("emits both CSRF tokens as their own attributes, with different values", async () => {
    expect(attrsOf(await enrol(), `data-scope="${PASSKEY_SCOPE}"`)).toEqual({
      "data-scope": PASSKEY_SCOPE,
      [PASSKEY_MODE_ATTR]: "registration",
      [PASSKEY_OPTIONS_PATH_ATTR]: "/auth/enrol/passkey/register/begin",
      [PASSKEY_VERIFY_PATH_ATTR]: "/auth/enrol/passkey/register/finish",
      [PASSKEY_OPTIONS_TOKEN_ATTR]: "opt-tok",
      [PASSKEY_VERIFY_TOKEN_ATTR]: "ver-tok",
      class: "flex flex-col gap-3",
    });
  });

  // A ceremony spans two endpoints and `csrfProtection` binds a token to one path, so one token used
  // twice is a 403 on whichever endpoint it was not minted for. This is the assertion that catches it.
  it("never emits the same token for both endpoints", async () => {
    const attrs = attrsOf(await enrol(), `data-scope="${PASSKEY_SCOPE}"`);
    expect(attrs[PASSKEY_OPTIONS_TOKEN_ATTR]).not.toBe(attrs[PASSKEY_VERIFY_TOKEN_ATTR]);
    expect([attrs[PASSKEY_OPTIONS_TOKEN_ATTR], attrs[PASSKEY_VERIFY_TOKEN_ATTR]]).toEqual(["opt-tok", "ver-tok"]);
  });

  it("carries the app's own CSRF header name only when it differs from the default", async () => {
    expect(attrsOf(await enrol(), `data-scope="${PASSKEY_SCOPE}"`)[PASSKEY_CSRF_HEADER_ATTR]).toBeUndefined();
    const named = await enrol({ contract: { ...CONTRACT, csrfHeader: "X-App-Csrf" } });
    expect(attrsOf(named, `data-scope="${PASSKEY_SCOPE}"`)[PASSKEY_CSRF_HEADER_ATTR]).toBe("X-App-Csrf");
  });

  it("carries the post-ceremony destination only when the loader supplied one", async () => {
    expect(attrsOf(await enrol(), `data-scope="${PASSKEY_SCOPE}"`)[PASSKEY_REDIRECT_ATTR]).toBeUndefined();
    const routed = await enrol({ contract: { ...CONTRACT, redirect: "/account/passkeys" } });
    expect(attrsOf(routed, `data-scope="${PASSKEY_SCOPE}"`)[PASSKEY_REDIRECT_ATTR]).toBe("/account/passkeys");
  });
});

describe("PasskeyEnrolView markup", () => {
  it("gives the nickname field a label and an accessible name derived from the field helpers", async () => {
    const html = await enrol();
    expect(tagOf(html, `data-ref="${PASSKEY.nickname}"`)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" ' +
        `data-ref="${PASSKEY.nickname}" autocomplete="off" id="field-nickname" name="nickname" aria-describedby="field-nickname-description">`,
    );
    expect(elementOf(html, "label", 'for="field-nickname"')).toBe(
      '<label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground ' +
        'group-data-[disabled]/field:opacity-50" for="field-nickname">Name this passkey</label>',
    );
  });

  it("names the account the enrolment is for, escaped", async () => {
    expect(textOf(await enrol({ email: HOSTILE_TEXT }), "div", 'data-slot="card-description"')).toBe(
      `Your account needs a second factor before you can continue. Signed in as ${HOSTILE_TEXT_ESCAPED}.`,
    );
  });

  it("renders the unsupported fallback hidden, so a browser without WebAuthn is told rather than stuck", async () => {
    expect(elementOf(await enrol(), "p", `data-ref="${PASSKEY.unsupported}"`)).toBe(
      `<p data-ref="${PASSKEY.unsupported}" hidden class="max-w-prose text-sm text-pretty text-muted-foreground">` +
        "This browser cannot create passkeys. Open this page in a current Chrome, Edge, Firefox or Safari.</p>",
    );
  });

  it("opens no second live region", async () => {
    expect(valuesOf(await enrol(), "aria-live")).toEqual([]);
  });

  it("names a refusal in a titled destructive alert", async () => {
    const html = await enrol({ error: "That passkey is already registered." });
    expect(textOf(html, "div", 'data-slot="alert-title"')).toBe("Enrolment failed");
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe("That passkey is already registered.");
  });

  it("renders no alert at all when nothing was refused", async () => {
    expect(elementOf(await enrol(), "div", 'data-slot="alert"')).toBe("");
  });
});

// The other half of the distinction `verify.test.tsx` pins: this is the page an *enrolment* demand
// lands on, and nothing about it reads as a step-up.
describe("PasskeyEnrolView and the step-up/enrolment distinction", () => {
  it("is the page for an enrolment demand, and renders a registration ceremony rather than a code field", async () => {
    const cell = authFactorGrid([]).find((entry) => entry.label === "passkey+totp-app / second-factor:always");
    expect(await factorDemand(cell as never)).toEqual({ status: "enrolment-required", kinds: ["totp-app"] });

    const html = await enrol();
    expect(textOf(html, "h1", 'class="text-xl"')).toBe("Add a passkey");
    expect(attrsOf(html, `data-scope="${PASSKEY_SCOPE}"`)[PASSKEY_MODE_ATTR]).toBe("registration");
    expect(tagOf(html, 'id="field-code"')).toBe("");
  });
});

// The defect this closes: the way out of this page was `<Link href={signoutPath}>`, a GET to a route
// `routes.ts` declares as `post("/signout")` — so it could not work at all, and a visitor who could
// not enrol now had no way off the page.
describe("PasskeyEnrolView sign-out", () => {
  it("submits the sign-out rather than linking it, since the route is POST-only", async () => {
    const html = await enrol();
    expect(attrOf(html, 'data-ref="passkey-signout"', "type")).toBe("submit");
    expect(tagOf(html, 'href="/auth/signout"')).toBe("");
  });

  it("posts to the sign-out path with the token the route needs, so csrfProtection admits it", async () => {
    const html = await enrol();
    expect(attrOf(html, 'data-slot="form"', "method")).toBe("post");
    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/auth/signout");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("csrf-signout");
  });
});
