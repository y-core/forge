import { describe, expect, it } from "bun:test";

import { createElement } from "../../jsx/element";
import { render } from "../../testing/render";
import {
  attrOf,
  attrsOf,
  AUTH_FACTOR_CAPABILITIES,
  AUTH_FACTOR_ASSIGNMENTS,
  authFactorGrid,
  authFactorOfferings,
  elementOf,
  elementsOf,
  factorChoices,
  factorDemand,
  HOSTILE_TEXT,
  HOSTILE_TEXT_ESCAPED,
  tagOf,
  textOf,
  valuesOf,
} from "./test-support";

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

describe("AUTH_FACTOR_CAPABILITIES", () => {
  it("makes TOTP-app step-up only, which is what stops a view offering it as primary", () => {
    expect(AUTH_FACTOR_CAPABILITIES["totp-app"]).toEqual({ primary: false, stepUp: true });
  });
});

describe("authFactorGrid", () => {
  const grid = authFactorGrid();

  it("crosses every offering with every assignment", () => {
    expect(grid).toHaveLength(authFactorOfferings().length * AUTH_FACTOR_ASSIGNMENTS.length);
  });

  it("names a primary per candidate, and none for a set with no factor that can be one", () => {
    expect(authFactorOfferings().map((offering) => `${offering.kinds.join("+") || "none"}:${offering.primary ?? "-"}`)).toEqual([
      "none:-",
      "email-otp:email-otp",
      "passkey:passkey",
      "totp-app:-",
      "email-otp+passkey:email-otp",
      "email-otp+passkey:passkey",
      "email-otp+totp-app:email-otp",
      "passkey+totp-app:passkey",
      "email-otp+passkey+totp-app:email-otp",
      "email-otp+passkey+totp-app:passkey",
    ]);
  });

  it("never names `totp-app` as a primary candidate", () => {
    expect(authFactorOfferings().filter((offering) => offering.primary === "totp-app")).toEqual([]);
  });

  it("labels each cell by its offered set and assignment", () => {
    expect(grid.map((cell) => cell.label).slice(0, 5)).toEqual([
      "none / all-optional",
      "none / all-mandatory",
      "none / first-mandatory",
      "none / for-roles",
      "email-otp primary=email-otp / all-optional",
    ]);
  });

  it("records a refusal rather than throwing, so an illegal cell is still a cell", () => {
    const cell = grid.find((entry) => entry.label === "none / all-optional");
    expect(cell?.registry).toBeNull();
    expect(cell?.refusal).toBe("createFactorRegistry: at least one factor must be offered");
  });

  it("refuses a TOTP-app-only offering, because no offered factor can be primary", () => {
    const cell = grid.find((entry) => entry.label === "totp-app / all-optional");
    expect(cell?.refusal).toBe("createFactorRegistry: no offered factor is declared primary");
  });

  it("admits an offering with nothing able to step up, which is simply a deployment offering no second factor", () => {
    const cell = grid.find((entry) => entry.label === "passkey primary=passkey / all-mandatory");
    expect(cell?.refusal).toBeNull();
    expect(cell?.registry?.seconds).toEqual([]);
  });

  it("never resolves `totp-app` as the primary factor in any legal cell", () => {
    const primaries = grid.map((cell) => factorChoices(cell)?.primary ?? null);
    expect(primaries.filter((primary) => primary === "totp-app")).toEqual([]);
  });
});

describe("factorChoices", () => {
  const grid = authFactorGrid();
  const cellAt = (label: string) => grid.find((entry) => entry.label === label);

  it("reads the primary and the step-up set off the registry", () => {
    expect(factorChoices(cellAt("email-otp+passkey primary=email-otp / all-mandatory") as never)).toEqual({
      primary: "email-otp",
      stepUp: ["passkey"],
      enrollable: ["passkey"],
    });
  });

  it("leaves `enrollable` empty when the only step-up factor is the implicit one", () => {
    expect(factorChoices(cellAt("email-otp+passkey primary=passkey / all-optional") as never)).toEqual({
      primary: "passkey",
      stepUp: ["email-otp"],
      enrollable: [],
    });
  });

  it("offers TOTP-app for step-up and never as primary", () => {
    expect(factorChoices(cellAt("passkey+totp-app primary=passkey / all-mandatory") as never)).toEqual({
      primary: "passkey",
      stepUp: ["totp-app"],
      enrollable: ["totp-app"],
    });
  });

  it("returns null for a refused cell", () => {
    expect(factorChoices(cellAt("none / all-optional") as never)).toBeNull();
  });
});

describe("factorDemand", () => {
  it("demands an enrolment when nothing is enrolled and the factor is mandatory", async () => {
    const cell = authFactorGrid([]).find((entry) => entry.label === "passkey+totp-app primary=passkey / all-mandatory");
    expect(await factorDemand(cell as never)).toEqual({ status: "enrolment-required", kinds: ["totp-app"] });
  });

  it("demands a step-up once that factor is enrolled, which is the state the enrolment demand is not", async () => {
    const cell = authFactorGrid(["totp-app"]).find((entry) => entry.label === "passkey+totp-app primary=passkey / all-mandatory");
    expect(await factorDemand(cell as never)).toEqual({ status: "step-up-required", kinds: ["totp-app"] });
  });

  it("demands nothing where every second factor is optional and none is enrolled", async () => {
    const cell = authFactorGrid([]).find((entry) => entry.label === "passkey+totp-app primary=passkey / all-optional");
    expect(await factorDemand(cell as never)).toEqual({ status: "satisfied" });
  });
});

describe("AUTH_FACTOR_ASSIGNMENTS", () => {
  it("names every assignment distinctly, and each assigns what its name says", () => {
    expect(AUTH_FACTOR_ASSIGNMENTS.map((assignment) => [assignment.label, assignment.requirement(0), assignment.requirement(1)])).toEqual([
      ["all-optional", "optional", "optional"],
      ["all-mandatory", "mandatory", "mandatory"],
      ["first-mandatory", "mandatory", "optional"],
      ["for-roles", { mandatoryForRoles: ["admin"] }, { mandatoryForRoles: ["admin"] }],
    ]);
  });
});
