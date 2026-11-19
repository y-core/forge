/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import type { AuthSessionRecord } from "../../types";
import { attrOf, elementsOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, textOf, valuesOf } from "../web.fixture";
import { AUTH_SESSION_LIST_ID, SessionListView } from "./session-list";
import type { SessionListViewProps } from "./types";

const CURRENT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const SIGNED_IN_AT = 1735689600000;
const SEEN_AT = 1738368000000;

function record(overrides: Partial<AuthSessionRecord> = {}): AuthSessionRecord {
  return {
    id: CURRENT,
    signedInAt: SIGNED_IN_AT,
    expiresAt: SIGNED_IN_AT + 1,
    lastSeenAt: SEEN_AT,
    stepUpAt: null,
    stepUpKind: null,
    device: "Firefox on macOS",
    ...overrides,
  };
}

function sessions(props: Partial<SessionListViewProps> = {}) {
  return render(
    <SessionListView
      rows={[record(), record({ id: OTHER, device: "Safari on iOS" })]}
      currentId={CURRENT}
      revokePath='/account/sessions/revoke'
      revokeToken='revoke-token'
      revokeOthersPath='/account/sessions/revoke-others'
      revokeOthersToken='others-token'
      {...props}
    />,
  );
}

const rowsOf = (html: string) => elementsOf(html, "li", 'data-ref="session"');

describe("SessionListView", () => {
  it("renders one row per session under the list's id, naming each by its device and escaping it", async () => {
    const html = await sessions({ rows: [record({ device: HOSTILE_TEXT }), record({ id: OTHER, device: null })] });
    expect({
      id: attrOf(html, `id="${AUTH_SESSION_LIST_ID}"`, "id"),
      devices: rowsOf(html).map((row) => textOf(row, "span", 'data-ref="session-device"')),
    }).toEqual({ id: AUTH_SESSION_LIST_ID, devices: [HOSTILE_TEXT_ESCAPED, "Unknown device"] });
  });

  it("marks only the session the page is read from, and offers it no sign-out of its own", async () => {
    const html = await sessions();
    expect(rowsOf(html).map((row) => [row.includes('data-ref="session-current"'), row.includes('data-ref="session-revoke"')])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("dates the sign-in and the last activity from their stored milliseconds", async () => {
    const [row = ""] = rowsOf(await sessions());
    expect(valuesOf(row, "datetime")).toEqual([new Date(SIGNED_IN_AT).toISOString(), new Date(SEEN_AT).toISOString()]);
  });

  it("names the factor a session stepped up with, and says nothing for one that never did", async () => {
    const html = await sessions({ rows: [record({ stepUpAt: SEEN_AT, stepUpKind: "totp-app" }), record({ id: OTHER })] });
    expect(rowsOf(html).map((row) => textOf(row, "span", 'data-ref="session-step-up"'))).toEqual(["Verified with Authenticator app", ""]);
  });

  it("posts each row's sign-out to one path with one token, naming its session in a field", async () => {
    const third = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d";
    const html = await sessions({ rows: [record(), record({ id: OTHER }), record({ id: third })] });
    const forms = elementsOf(html, "form", 'data-ref="session-revoke"');
    expect({
      actions: forms.map((form) => attrOf(form, 'data-ref="session-revoke"', "action")),
      tokens: forms.flatMap((form) => valuesOf(form, "value").filter((value) => value.endsWith("-token"))),
      sessions: forms.map((form) => /name="session" value="([^"]+)"/.exec(form)?.[1]),
    }).toEqual({
      actions: ["/account/sessions/revoke", "/account/sessions/revoke"],
      tokens: ["revoke-token", "revoke-token"],
      sessions: [OTHER, third],
    });
  });

  it("offers signing out everywhere else under its own token while another session exists, and not when this is the only one", async () => {
    const both = othersForm(await sessions());
    const alone = othersForm(await sessions({ rows: [record()] }));
    expect({ both, alone }).toEqual({ both: ["/account/sessions/revoke-others", "others-token"], alone: null });
  });
});

/** The action and token of the sign-out-everywhere-else form, or `null` where none rendered. */
function othersForm(html: string): [string, string] | null {
  const [form] = elementsOf(html, "form", 'data-ref="sessions-revoke-others"');
  if (form === undefined) return null;
  return [attrOf(form, 'data-ref="sessions-revoke-others"', "action"), valuesOf(form, "value")[0] ?? ""];
}
