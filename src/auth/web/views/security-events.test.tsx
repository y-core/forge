/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { classesOf, variantClasses } from "../../../testing/markup";
import { render } from "../../../testing/render";
import type { AuthFactorKind, AuthSecurityEvent, AuthSecurityEventType } from "../../types";
import { attrOf, elementsOf, textOf, valuesOf } from "../web.fixture";
import { FACTOR_LABEL } from "./factors";
import { AUTH_SECURITY_EVENT_LIST_ID, SecurityEventListView } from "./security-events";
import type { SecurityEventListViewProps } from "./types";

const SESSION = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ADMIN = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AT = 1735689600000;

const EVERY_TYPE = [
  "signed-in",
  "stepped-up",
  "sessions-revoked",
  "factor-added",
  "factor-removed",
  "factor-replaced",
  "recovery-codes-issued",
  "recovery-code-used",
  "email-changed",
  "admin-granted",
  "admin-revoked",
  "factors-reset",
  "account-deactivated",
  "account-reactivated",
] as const satisfies readonly AuthSecurityEventType[];

const EVERY_TYPE_LISTED: [Exclude<AuthSecurityEventType, (typeof EVERY_TYPE)[number]>] extends [never] ? true : false = true;

const EVERY_FACTOR = ["email-otp", "passkey", "recovery-code", "totp-app"] as const satisfies readonly AuthFactorKind[];

const EVERY_FACTOR_LISTED: [Exclude<AuthFactorKind, (typeof EVERY_FACTOR)[number]>] extends [never] ? true : false = true;

function event(overrides: Partial<AuthSecurityEvent> = {}): AuthSecurityEvent {
  return {
    id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d",
    userId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e",
    type: "signed-in",
    factorKind: "email-otp",
    sessionId: SESSION,
    adminId: null,
    at: AT,
    ...overrides,
  };
}

const ROOT = `id="${AUTH_SECURITY_EVENT_LIST_ID}"`;
const rowsOf = (html: string) => elementsOf(html, "li", 'data-ref="security-event"');
const labelsOf = (html: string) => rowsOf(html).map((row) => textOf(row, "span", 'data-ref="security-event-type"'));
const occurrences = (html: string, needle: string) => html.split(needle).length - 1;
const headingsOf = (html: string) =>
  [...html.matchAll(/<(h[1-6])[^>]*>(.*?)<\/\1>/g)].map((match) => [match[1], match[2]?.replace(/<[^>]+>/g, "")]);

describe("SecurityEventListView", () => {
  it("renders one row per event under the list's id, naming each by its type and factor and dating it", async () => {
    const html = await render(<SecurityEventListView rows={[event(), event({ id: "b", type: "factors-reset", factorKind: null, at: AT + 1 })]} />);
    expect({
      id: attrOf(html, ROOT, "id"),
      types: rowsOf(html).map((row) => textOf(row, "span", 'data-ref="security-event-type"')),
      factors: rowsOf(html).map((row) => textOf(row, "span", 'data-ref="security-event-factor"')),
      times: rowsOf(html).flatMap((row) => valuesOf(row, "datetime")),
    }).toEqual({
      id: AUTH_SECURITY_EVENT_LIST_ID,
      types: ["Signed in", "Factors reset"],
      factors: ["Emailed code", ""],
      times: [new Date(AT).toISOString(), new Date(AT + 1).toISOString()],
    });
  });

  it("gives every security event type its own readable label, never its stored slug", async () => {
    const html = await render(<SecurityEventListView rows={EVERY_TYPE.map((type, index) => event({ id: `e${index}`, type }))} />);
    const labels = labelsOf(html);
    expect({
      listed: EVERY_TYPE_LISTED,
      rows: labels.length,
      blank: labels.filter((label) => label.trim() === ""),
      slugs: labels.filter((label, index) => label === EVERY_TYPE[index]),
      distinct: new Set(labels).size,
    }).toEqual({ listed: true, rows: EVERY_TYPE.length, blank: [], slugs: [], distinct: EVERY_TYPE.length });
  });

  it("names every factor kind in the words the factors panel uses for it", async () => {
    const html = await render(<SecurityEventListView rows={EVERY_FACTOR.map((factorKind, index) => event({ id: `f${index}`, factorKind }))} />);
    expect({ listed: EVERY_FACTOR_LISTED, factors: rowsOf(html).map((row) => textOf(row, "span", 'data-ref="security-event-factor"')) }).toEqual({
      listed: true,
      factors: EVERY_FACTOR.map((kind) => FACTOR_LABEL[kind]),
    });
  });

  it("renders no factor line at all for an event that names no factor", async () => {
    const [row = ""] = rowsOf(await render(<SecurityEventListView rows={[event({ type: "email-changed", factorKind: null })]} />));
    expect(elementsOf(row, "span", 'data-ref="security-event-factor"')).toEqual([]);
  });

  it("says an administrator acted only on the rows an administrator made, with or without a factor", async () => {
    const html = await render(
      <SecurityEventListView
        rows={[
          event({ id: "a", type: "admin-granted", factorKind: null, adminId: ADMIN }),
          event({ id: "b" }),
          event({ id: "c", type: "factors-reset", factorKind: "passkey", adminId: ADMIN }),
          event({ id: "d", type: "account-deactivated", factorKind: null }),
        ]}
      />,
    );
    expect(rowsOf(html).map((row) => elementsOf(row, "span", 'data-ref="security-event-admin"').length)).toEqual([1, 0, 1, 0]);
  });

  it("reads each row as label, factor, date and the administrator marker, in that order", async () => {
    const html = await render(<SecurityEventListView rows={[event({ adminId: ADMIN, type: "admin-granted" }), event({ id: "b" })]} />);
    expect(rowsOf(html).map((row) => row.replace(/<[^>]+>/g, ""))).toEqual([
      "Administrator role grantedEmailed code2025-01-01 by an administrator",
      "Signed inEmailed code2025-01-01",
    ]);
  });

  it("never prints a session id or an administrator id, in text or in any attribute", async () => {
    const html = await render(
      <SecurityEventListView
        rows={[
          event({ adminId: ADMIN, type: "admin-revoked" }),
          event({ id: "b", type: "sessions-revoked", factorKind: null }),
          event({ id: "c", sessionId: null, adminId: ADMIN, type: "factors-reset", factorKind: null }),
        ]}
      />,
    );
    expect({ rows: rowsOf(html).length, session: occurrences(html, SESSION), admin: occurrences(html, ADMIN) }).toEqual({
      rows: 3,
      session: 0,
      admin: 0,
    });
  });

  it("shows an empty state, and no list, for an account with no events", async () => {
    const html = await render(<SecurityEventListView rows={[]} />);
    expect({ list: elementsOf(html, "ul", 'data-ref="security-event-list"'), rows: rowsOf(html), headings: headingsOf(html) }).toEqual({
      list: [],
      rows: [],
      headings: [
        ["h1", "Recent activity"],
        ["h2", "No activity recorded"],
      ],
    });
  });

  const levels: { level: SecurityEventListViewProps["level"]; own: string; nested: string }[] = [
    { level: undefined, own: "h1", nested: "h2" },
    { level: 1, own: "h1", nested: "h2" },
    { level: 2, own: "h2", nested: "h3" },
    { level: 3, own: "h3", nested: "h4" },
    { level: 4, own: "h4", nested: "h5" },
    { level: 5, own: "h5", nested: "h6" },
    { level: 6, own: "h6", nested: "h6" },
  ];

  for (const { level, own, nested } of levels) {
    it(`at level ${String(level)} titles itself with an ${own} and its empty state with an ${nested}`, async () => {
      const html = await render(<SecurityEventListView rows={[]} level={level} />);
      expect(headingsOf(html)).toEqual([
        [own, "Recent activity"],
        [nested, "No activity recorded"],
      ]);
    });
  }

  it("composes the host's class onto the root after its own, so the host's width wins", async () => {
    const baseline = await render(<SecurityEventListView rows={[event()]} />);
    const html = await render(<SecurityEventListView rows={[event()]} class='max-w-none' />);
    const ownWidths = classesOf(baseline, ROOT).filter((token) => token.startsWith("max-w-"));
    expect({ ownWidths: ownWidths.length, change: variantClasses(html, baseline, ROOT), last: classesOf(html, ROOT).at(-1) }).toEqual({
      ownWidths: 1,
      change: { added: ["max-w-none"], dropped: ownWidths },
      last: "max-w-none",
    });
  });
});
