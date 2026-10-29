import { describe, expect, it } from "bun:test";

import { attribute, call, literal, other, runRule } from "../lint.fixture.ts";
import { a11yStateAttrsSource } from "./a11y-state-attrs-source.ts";

const CORPUS = "(forge-ui-a11y-state-attrs-source — src/ui/design/reference/10-accessibility.md)";

const detail = (token: string, state: string): string =>
  `\`${token}\` styles from \`aria-${state}\` — read the state from \`data-${state}\`, which \`STATE_ATTRS\` registers ${CORPUS}`;

describe("a11y-state-attrs-source", () => {
  for (const [text, state] of [
    ["aria-selected:bg-accent", "selected"],
    ["aria-[checked]:before:size-4", "checked"],
    ["aria-[invalid=true]:border-destructive", "invalid"],
    ["group-aria-selected:font-bold", "selected"],
    ["peer-aria-checked/opt:block", "checked"],
    ["[&[aria-pressed=true]]:bg-accent", "pressed"],
    ["md:aria-disabled:opacity-50", "disabled"],
    ["aria-[orientation=vertical]:flex-col", "orientation"],
  ] as const) {
    it(`reports \`${text}\` as a read of \`aria-${state}\``, () => {
      expect(runRule(a11yStateAttrsSource, attribute("class", literal(text)))).toEqual([detail(text, state)]);
    });
  }

  for (const text of [
    "aria-expanded:rotate-180",
    "aria-[current]:bg-accent",
    "data-selected:bg-accent",
    "aria-selected",
    "aria-selectedness:underline",
    "aria-disabled-x:underline",
    "[&:is([role=menuitemcheckbox],[role=menuitemradio])]:before:size-4",
  ]) {
    it(`leaves \`${text}\` alone`, () => {
      expect(runRule(a11yStateAttrsSource, attribute("class", literal(text)))).toEqual([]);
    });
  }

  it("reports a variant inside a `cn()` argument", () => {
    expect(runRule(a11yStateAttrsSource, call("cn", literal("rounded aria-selected:bg-accent")))).toEqual([
      detail("aria-selected:bg-accent", "selected"),
    ]);
  });

  it("reports a repeated token once", () => {
    expect(runRule(a11yStateAttrsSource, attribute("class", literal("aria-busy:opacity-50 aria-busy:opacity-50")))).toEqual([
      detail("aria-busy:opacity-50", "busy"),
    ]);
  });

  it("leaves a string outside a class position alone, since prose is not a variant", () => {
    expect(runRule(a11yStateAttrsSource, other("VariableDeclarator", literal("aria-selected:bg-accent is what tabs used")))).toEqual([]);
  });
});
