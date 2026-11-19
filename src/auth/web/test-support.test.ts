import { describe, expect, it } from "bun:test";

import { createElement } from "../../render/jsx/element";
import { render } from "../../testing/render";
import {
  attrOf,
  attrsOf,
  authFactorAssignments,
  AUTH_FACTOR_SETS,
  authFactorGrid,
  elementOf,
  elementsOf,
  factorChoices,
  factorDemand,
  fakeRecoveryCodeStore,
  HOSTILE_TEXT,
  HOSTILE_TEXT_ESCAPED,
  tagOf,
  textOf,
  valuesOf,
} from "./web.fixture";

const MARKUP =
  '<form data-scope="passkey" data-passkey-mode="registration" novalidate>' +
  '<p data-ref="a">Ada &amp; Co</p>' +
  '<p data-ref="b">Grace &lt;g&gt;</p>' +
  "</form>";

describe("HOSTILE_TEXT / HOSTILE_TEXT_ESCAPED", () => {
  it("escapes every character the encoding map covers, in a text node", async () => {
    const html = await render(createElement("p", { children: HOSTILE_TEXT }));
    expect(html).toBe(`<p>${HOSTILE_TEXT_ESCAPED}</p>`);
  });

  it("escapes the same characters the same way in an attribute value", async () => {
    const html = await render(createElement("p", { title: HOSTILE_TEXT, children: "x" }));
    expect(html).toBe(`<p title="${HOSTILE_TEXT_ESCAPED}">x</p>`);
  });
});

describe("tagOf", () => {
  it("returns the whole opening tag of the element carrying the selector", () => {
    expect(tagOf(MARKUP, 'data-scope="passkey"')).toBe('<form data-scope="passkey" data-passkey-mode="registration" novalidate>');
  });

  it("returns an empty string when nothing carries the selector", () => {
    expect(tagOf(MARKUP, 'data-scope="totp"')).toBe("");
  });

  it("does not match a selector that is only a prefix of an attribute name", () => {
    expect(tagOf(MARKUP, "data-passkey-mod")).toBe("");
  });
});

describe("attrOf", () => {
  it("returns the exact attribute value", () => {
    expect(attrOf(MARKUP, 'data-scope="passkey"', "data-passkey-mode")).toBe("registration");
  });

  it("returns an empty string for an attribute the element does not carry", () => {
    expect(attrOf(MARKUP, 'data-scope="passkey"', "data-passkey-redirect")).toBe("");
  });
});

describe("attrsOf", () => {
  it("returns every attribute of the element, valueless ones as an empty string", () => {
    expect(attrsOf(MARKUP, 'data-scope="passkey"')).toEqual({ "data-scope": "passkey", "data-passkey-mode": "registration", novalidate: "" });
  });

  it("distinguishes two attributes carrying the same value, which is what a duplicated token looks like", () => {
    const html = '<form data-a="t1" data-b="t1"></form>';
    expect(attrsOf(html, 'data-a="t1"')).toEqual({ "data-a": "t1", "data-b": "t1" });
  });
});

describe("elementsOf and elementOf", () => {
  it("returns every matching element whole, in document order", () => {
    expect(elementsOf(MARKUP, "p", "data-ref")).toEqual(['<p data-ref="a">Ada &amp; Co</p>', '<p data-ref="b">Grace &lt;g&gt;</p>']);
  });

  it("returns the first matching element whole", () => {
    expect(elementOf(MARKUP, "p", 'data-ref="b"')).toBe('<p data-ref="b">Grace &lt;g&gt;</p>');
  });

  it("returns an empty string when nothing matches", () => {
    expect(elementOf(MARKUP, "p", 'data-ref="z"')).toBe("");
  });
});

describe("textOf", () => {
  it("returns the inner markup with its entities intact", () => {
    expect(textOf(MARKUP, "p", 'data-ref="a"')).toBe("Ada &amp; Co");
  });
});

describe("valuesOf", () => {
  it("returns every value the attribute takes, in document order", () => {
    expect(valuesOf(MARKUP, "data-ref")).toEqual(["a", "b"]);
  });
});

describe("authFactorGrid", () => {
  const grid = authFactorGrid();

  it("crosses every second-factor offering with each subset of it made mandatory", () => {
    const expected = AUTH_FACTOR_SETS.reduce((total, kinds) => total + 2 ** kinds.length, 0);
    expect(grid).toHaveLength(expected);
  });

  it("labels each cell by its offered second factors and which of them are mandatory", () => {
    expect(grid.map((cell) => cell.label)).toEqual([
      "none / optional",
      "passkey / optional",
      "passkey / mandatory:passkey",
      "totp-app / optional",
      "totp-app / mandatory:totp-app",
      "passkey+totp-app / optional",
      "passkey+totp-app / mandatory:passkey",
      "passkey+totp-app / mandatory:totp-app",
      "passkey+totp-app / mandatory:passkey+totp-app",
    ]);
  });

  it("builds a deployment offering no second factor as one with nothing to resolve", () => {
    const empty = grid
      .filter((cell) => cell.kinds.length === 0)
      .map((cell) => [cell.registry.seconds, cell.registry.recovery, cell.registry.mandatory]);
    expect(empty).toEqual([[[], null, []]]);
  });

  it("makes exactly the cell's assigned kinds mandatory on its registry", () => {
    expect(grid.every((cell) => JSON.stringify(cell.registry.mandatory) === JSON.stringify(cell.assignment.mandatory))).toBe(true);
  });

  it("resolves `email-otp` as the primary factor in every cell, because only it identifies the visitor", () => {
    expect([...new Set(grid.map((cell) => factorChoices(cell).primary))]).toEqual(["email-otp"]);
  });
});

describe("factorChoices", () => {
  const grid = authFactorGrid();
  const cellAt = (label: string) => grid.find((entry) => entry.label === label);

  it("reads the step-up set off the registry, recovery codes last", () => {
    expect(factorChoices(cellAt("passkey+totp-app / mandatory:totp-app") as never)).toEqual({
      primary: "email-otp",
      stepUp: ["passkey", "totp-app", "recovery-code"],
      enrollable: ["passkey", "totp-app", "recovery-code"],
    });
  });

  it("offers nothing to step up with where no second factor is offered", () => {
    expect(factorChoices(cellAt("none / optional") as never)).toEqual({ primary: "email-otp", stepUp: [], enrollable: [] });
  });
});

describe("factorDemand", () => {
  it("demands an enrolment of the mandatory kind alone when nothing is enrolled", async () => {
    const cell = authFactorGrid([]).find((entry) => entry.label === "passkey+totp-app / mandatory:totp-app");
    expect(await factorDemand(cell as never)).toEqual({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] });
  });

  it("demands a step-up once the mandatory kind is enrolled, which is the state the enrolment demand is not", async () => {
    const cell = authFactorGrid(["totp-app"]).find((entry) => entry.label === "passkey+totp-app / mandatory:totp-app");
    expect(await factorDemand(cell as never)).toEqual({ status: "step-up-required", kinds: ["totp-app"] });
  });

  it("demands nothing where the second factor is optional and none is enrolled", async () => {
    const cell = authFactorGrid([]).find((entry) => entry.label === "totp-app / optional");
    expect(await factorDemand(cell as never)).toEqual({ status: "satisfied" });
  });
});

describe("fakeRecoveryCodeStore", () => {
  const hash = (byte: number) => new Uint8Array([byte]) as Uint8Array<ArrayBuffer>;

  it("keeps a staged set out of use until it is committed, then drops the set it replaced", async () => {
    const store = fakeRecoveryCodeStore();
    await store.stage("u1", [hash(1)], 1);
    await store.commit("u1", "f1", 1, { keep: null });
    await store.stage("u1", [hash(2), hash(3)], 2);

    const before = [await store.consume("u1", "f1", hash(2), 2, { keep: null }), await store.remaining("u1")];
    await store.commit("u1", "f1", 3, { keep: null });
    const after = [await store.consume("u1", "f1", hash(1), 3, { keep: null }), await store.remaining("u1")];

    expect([...before, ...after].map((answer) => (answer.ok ? answer.data : null))).toEqual([false, 1, false, 2]);
  });

  it("spends a live code once, and never another user's", async () => {
    const store = fakeRecoveryCodeStore();
    await store.stage("u1", [hash(1)], 1);
    await store.commit("u1", "f1", 1, { keep: null });

    const answers = [
      await store.consume("u2", "f2", hash(1), 2, { keep: null }),
      await store.consume("u1", "f1", hash(1), 2, { keep: null }),
      await store.consume("u1", "f1", hash(1), 3, { keep: null }),
    ];
    expect(answers.map((answer) => (answer.ok ? answer.data : null))).toEqual([false, true, false]);
  });
});

describe("authFactorAssignments", () => {
  it("assigns all-optional first, then each subset of the offered kinds as mandatory, in offer order", () => {
    expect(authFactorAssignments(["passkey", "totp-app"]).map((assignment) => [assignment.label, assignment.mandatory])).toEqual([
      ["optional", []],
      ["mandatory:passkey", ["passkey"]],
      ["mandatory:totp-app", ["totp-app"]],
      ["mandatory:passkey+totp-app", ["passkey", "totp-app"]],
    ]);
  });
});
