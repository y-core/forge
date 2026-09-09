import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import { signature } from "./class-groups-parse";
import { loadDesignSystem } from "./design-system";

const ROOT = resolve(import.meta.dir, "../../../..");
const STYLESHEET = "src/ui/assets/css/tailwind.css";

// `browser-test-helper.ts` serves the stylesheets raw, so an `@utility` resolves to nothing in a
// mounted page and the compiled selector can only be read here.
const compile = async (candidate: string): Promise<string> => {
  const [css] = (await loadDesignSystem(resolve(ROOT, STYLESHEET))).candidatesToCss([candidate]);
  if (typeof css !== "string") throw new Error(`\`${candidate}\` compiles to nothing`);
  return css;
};

// `X:is(a, b)` written back out as `Xa, Xb`, so the assertions below stay exact matches against the
// selector each recipe means rather than against the grouping it happens to be spelled with.
function expandIs(css: string): string {
  const open = css.indexOf(":is(");
  if (open === -1) return css;
  // The closing paren is found by counting, not by a lazy regex: every argument list here contains
  // `:has(…)`, whose own paren would end the match at the wrong place.
  let depth = 0;
  let close = open + 3;
  const parts: string[] = [];
  let held = "";
  for (; close < css.length; close += 1) {
    const character = css[close];
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
    if (character === "," && depth === 1) {
      parts.push(held.trim());
      held = "";
      continue;
    }
    if (!(depth === 1 && held === "" && character === "(")) held += character;
  }
  parts.push(held.trim());
  const prefix = css.slice(0, open).split(/[\s,]/).pop() ?? "";
  const head = css.slice(0, open - prefix.length);
  return `${head}${parts.map((part) => `${prefix}${part}`).join(", ")}${expandIs(css.slice(close + 1))}`;
}

// `Switch`, `Toggle` and both group roots put the state prop on a hidden inner control and the
// recipe on the wrapping label, so a recipe matching only its own element is inert on them.
describe("the state recipes reach a wrapped control through :has()", () => {
  for (const [utility, attributes] of [
    ["state-busy", ['[aria-busy="true"]', "[data-busy]"]],
    ["state-invalid", ['[aria-invalid="true"]']],
    ["state-disabled", [":disabled"]],
  ] as const) {
    it(`${utility} matches its own element and a descendant carrying the state`, async () => {
      const css = expandIs(await compile(utility));
      for (const attribute of attributes) {
        expect(css).toContain(`.${utility}${attribute}`);
        expect(css).toContain(`.${utility}:has(${attribute})`);
      }
    });
  }
});

// The admission test of UI_CLASS_COMPOSITION.md §1e, read off the compiled artefact rather than argued
// from the source: a recipe's signature is honest only when it writes at the scope it claims.
describe("the @utility recipes claim the scope they paint at", () => {
  const system = loadDesignSystem(resolve(ROOT, STYLESHEET));

  const signatureOf = async (utility: string): Promise<string> => signature((await system).candidatesToAst([utility])[0] ?? []);

  for (const [utility, expected] of [
    ["border-field", "border-width"],
    ["field-chrome", "background-color,border-color,border-radius,border-width,color,font-size,height,line-height,padding-inline,width"],
    ["otp-cells", "background-image,background-position,background-repeat,background-size,width"],
    ["otp-editor", "box-sizing,letter-spacing,padding-inline,width"],
  ] as const) {
    it(`${utility} paints its whole signature unconditionally, so the claim is honest`, async () => {
      expect(await signatureOf(utility)).toBe(expected);
      expect((await compile(utility)).startsWith(`.${utility} {`)).toBe(true);
    });
  }

  // The near miss: the ring variables are claimed at base scope and written only under focus.
  for (const [utility, ring] of [
    ["focus-ring", "--tw-inset-ring-color,--tw-inset-ring-shadow,--tw-outline-style"],
    ["focus-ring-outset", "--tw-outline-style,--tw-ring-color,--tw-ring-shadow"],
  ] as const) {
    it(`${utility} writes its ring only under :focus-visible, which is what makes it a near miss`, async () => {
      expect(await signatureOf(utility)).toBe(ring);
      const css = await compile(utility);
      expect(css).toContain(":focus-visible");
      expect(css).toContain(":has(:focus-visible)");
    });
  }
});
