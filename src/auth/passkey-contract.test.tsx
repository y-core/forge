/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../testing/render";
import { FakeElement } from "../ui/client/dom.fixture";
import { readPasskeyContract } from "./client/passkey";
import { PASSKEY, PASSKEY_CSRF_HEADER_DEFAULT, PASSKEY_MODE_ATTR, PASSKEY_REDIRECT_FALLBACK, PASSKEY_SCOPE } from "./passkey-contract";
import { PasskeyEnrolView } from "./web/views/passkey-enrol";
import type { AuthPasskeyContract } from "./web/views/types";
import { attrsOf, elementOf, fakeAuthIcon, valuesOf } from "./web/web.fixture";

const CONTRACT: AuthPasskeyContract = {
  mode: "registration",
  optionsPath: "/auth/enrol/passkey/register/begin",
  verifyPath: "/auth/enrol/passkey/register/finish",
  optionsToken: "opt-tok",
  verifyToken: "ver-tok",
};

const SCOPE_SELECTOR = `data-scope="${PASSKEY_SCOPE}"`;

async function enrolled(contract: AuthPasskeyContract): Promise<{ html: string; root: FakeElement }> {
  const html = await render(
    <PasskeyEnrolView
      contract={contract}
      signoutPath='/auth/signout'
      signoutCsrfToken='csrf-signout'
      email='ada@example.com'
      icon={fakeAuthIcon}
    />,
  );
  return { html, root: new FakeElement("DIV", attrsOf(html, SCOPE_SELECTOR)) };
}

/** The scope root as the controller receives it, minus one attribute the view emitted. */
function without(root: FakeElement, name: string): FakeElement {
  return new FakeElement("DIV", Object.fromEntries([...root.attrs].filter(([key]) => key !== name)));
}

describe("passkey contract — the wire format between a view and a controller that never import each other", () => {
  it("hands the controller back the ceremony the view was given, so neither side can rename an attribute alone", async () => {
    const { root } = await enrolled(CONTRACT);

    expect(readPasskeyContract(root as unknown as HTMLElement)).toEqual({
      ...CONTRACT,
      csrfHeader: PASSKEY_CSRF_HEADER_DEFAULT,
      redirect: PASSKEY_REDIRECT_FALLBACK,
    });
  });

  it("carries a renamed CSRF header and a redirect target through, rather than falling back over them", async () => {
    const contract = { ...CONTRACT, csrfHeader: "X-App-Csrf", redirect: "/account/passkeys" };
    const { root } = await enrolled(contract);

    expect(readPasskeyContract(root as unknown as HTMLElement)).toEqual(contract);
  });

  it("emits under the scope root exactly the refs the controller looks up, and no others", async () => {
    const { html } = await enrolled(CONTRACT);

    expect(new Set(valuesOf(elementOf(html, "div", SCOPE_SELECTOR), "data-ref"))).toEqual(new Set(Object.values(PASSKEY)));
  });

  it("refuses the ceremony when any ceremony attribute the view emitted is absent, rather than mounting half-configured", async () => {
    const { root } = await enrolled(CONTRACT);
    const emitted = [...root.attrs.keys()].filter((name) => name.startsWith("data-passkey-"));

    expect(emitted.length).toBe(5);
    for (const name of emitted) {
      expect(readPasskeyContract(without(root, name) as unknown as HTMLElement)).toBeNull();
    }
  });

  it("refuses a mode the view could never have rendered, so a hand-edited scope root starts nothing", async () => {
    const { root } = await enrolled(CONTRACT);
    root.setAttribute(PASSKEY_MODE_ATTR, "recovery");

    expect(readPasskeyContract(root as unknown as HTMLElement)).toBeNull();
  });
});
