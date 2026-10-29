import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { findModernCssSourceViolations } from "./modern-css-source-parse";

const TSX = "src/ui/core/fixture.tsx";
const TS = "src/ui/client/fixture.ts";
const CSS = "src/ui/assets/css/fixture.css";
const FACTORY =
  'function group(input: "checkbox" | "radio") {\n  return <input type={input} class="size-4 appearance-none rounded border" />;\n}\n';
const SHIPPED = readFileSync(new URL("../../../ui/core/checkable-group.tsx", import.meta.url).pathname, "utf-8");
const SHIPPED_CSS = readFileSync(new URL("../../../ui/assets/css/forge-ui.css", import.meta.url).pathname, "utf-8");

const ids = (source: string, file: string): string[] => findModernCssSourceViolations(source, file).map((finding) => finding.ruleId);

const lines = (source: string, file: string): string[] =>
  findModernCssSourceViolations(source, file).map((finding) => `${finding.line} ${finding.ruleId}`);

const exit = (source: string): string[] =>
  findModernCssSourceViolations(source, CSS)
    .filter((finding) => finding.ruleId === "forge-ui-platform-exit-geometry")
    .map((finding) => `${finding.line} ${finding.detail.split(" ")[0]}`);

describe("findModernCssSourceViolations() — Tier B behaviour", () => {
  it("flags a dialog role on an element that is not a `<dialog>`", () => {
    expect(findModernCssSourceViolations("<div role='dialog' aria-modal='true'>", TSX)).toEqual([
      {
        file: TSX,
        line: 1,
        ruleId: "forge-ui-platform-native-dialog",
        detail: "`role` on a `<div>` — open a native `<dialog>` with `showModal()` instead of re-declaring the role",
      },
      {
        file: TSX,
        line: 1,
        ruleId: "forge-ui-platform-native-dialog",
        detail: "`aria-modal` on a `<div>` — open a native `<dialog>` with `showModal()` instead of re-declaring the role",
      },
    ]);
  });

  it("does not flag the role on a native `<dialog>`", () => {
    expect(ids("<dialog role='dialog' aria-modal='true'>", TSX)).toEqual([]);
  });

  it("does not flag the role on a popover panel, which has the top layer the rule asks for", () => {
    expect(ids("<div popover='auto' role='dialog' aria-labelledby='p-title'>", TSX)).toEqual([]);
  });

  it("still flags aria-modal on a popover panel, which the platform never makes the page inert for", () => {
    expect(ids("<div popover='auto' aria-modal='true'>", TSX)).toEqual(["forge-ui-platform-native-dialog"]);
  });

  it("flags a floating panel declared with no popover attribute", () => {
    const source = ['const CLS = "absolute z-10 rounded border";', "<div data-slot='menu-popup' class={CLS}>"].join("\n");

    expect(lines(source, TSX)).toEqual(["2 forge-ui-platform-native-popover"]);
  });

  it("does not flag a panel that already declares `popover`", () => {
    const source = ['const CLS = "absolute z-10 rounded border";', "<div data-slot='menu-popup' popover='auto' class={CLS}>"].join("\n");

    expect(ids(source, TSX)).toEqual([]);
  });

  it("flags `aria-expanded` driven by a click handler", () => {
    const source = ["<button aria-expanded='false' data-slot='trigger'>", 'el.addEventListener("click", toggle);'].join("\n");

    expect(lines(source, TSX)).toEqual(["1 forge-ui-platform-native-details"]);
  });

  it("does not flag `aria-expanded` with no click handler in the file", () => {
    expect(ids("<summary aria-expanded='false'>", TSX)).toEqual([]);
  });

  it("flags a class set on an ancestor from a descendant", () => {
    expect(ids('el.closest("[data-scope]")?.classList.add("has-error");', TS)).toEqual(["forge-ui-platform-parent-state"]);
  });

  it("flags a saved-and-restored tabindex sweep", () => {
    expect(ids('node.setAttribute("tabindex", "-1");', TS)).toEqual(["forge-ui-platform-inert"]);
  });

  it("does not flag a roving tabindex, which moves focus rather than trapping it", () => {
    expect(ids("if (item) item.tabIndex = i === index ? 0 : -1;", TS)).toEqual([]);
  });

  it("flags a colour-scheme media query read from script", () => {
    expect(ids('const mql = win.matchMedia("(prefers-color-scheme: dark)");', TS)).toEqual(["forge-ui-platform-theme-detection"]);
  });

  it("honours a suppression comment on the colour-scheme query", () => {
    const source = [
      "/* modern-css-allow: forge-ui-platform-theme-detection — the theme is class-driven */",
      'const mql = win.matchMedia("(prefers-color-scheme: dark)");',
    ].join("\n");

    expect(ids(source, TS)).toEqual([]);
  });

  it("flags a scroll animated from script", () => {
    expect(ids('target.scrollIntoView({ behavior: "smooth" });', TS)).toEqual(["forge-ui-platform-smooth-scroll"]);
  });

  it("does not flag a scroll that only asks for the nearest block", () => {
    expect(ids('item.scrollIntoView?.({ block: "nearest", inline: "nearest" });', TS)).toEqual([]);
  });

  it("flags an interval mutating a transform", () => {
    expect(ids('setInterval(() => {\n  el.style.transform = "translateX(" + x + "px)";\n}, 16);', TS)).toEqual(["forge-ui-platform-ticker"]);
  });

  it("flags an index written into text content", () => {
    expect(ids("el.textContent = String(index + 1);", TS)).toEqual(["forge-ui-platform-counters"]);
  });

  it("flags a number stepped per frame", () => {
    expect(ids("requestAnimationFrame(() => {\n  el.textContent = value.toFixed(0);\n});", TS)).toEqual(["forge-ui-platform-count-up"]);
  });

  it("flags a gradient angle mutated per frame", () => {
    expect(ids('requestAnimationFrame(() => {\n  el.style.setProperty("--angle", a + "deg");\n});', TS)).toEqual([
      "forge-ui-platform-animated-border",
    ]);
  });

  it("flags coordinates computed per frame", () => {
    expect(ids("requestAnimationFrame(() => {\n  move(Math.cos(t) * r, Math.sin(t) * r);\n});", TS)).toEqual(["forge-ui-platform-motion-path"]);
  });

  it("flags clip geometry computed in script", () => {
    expect(ids('el.style.clipPath = "inset(0 " + rest + "% 0 0)";', TS)).toEqual(["forge-ui-platform-reveal-mask"]);
  });

  it("flags a class added inside an observer callback", () => {
    const source = [
      "const observer = new IntersectionObserver((records) => {",
      '  for (const record of records) record.target.classList.add("in-view");',
      "});",
    ].join("\n");

    expect(lines(source, TS)).toEqual(["2 forge-ui-platform-scroll-reveal"]);
  });

  it("does not flag an observer whose callback loads a module", () => {
    const source = [
      "const observerCtor = win.IntersectionObserver;",
      "const observer = new observerCtor((entries) => {",
      "  if (!entries[0]?.isIntersecting) return;",
      "  observer.disconnect();",
      "  options.load().then((mod) => options.init(mod, el));",
      "}, init);",
    ].join("\n");

    expect(ids(source, TS)).toEqual([]);
  });

  it("does not flag an observer whose callback moves an aria attribute", () => {
    const source = [
      "const observerCtor = win.IntersectionObserver;",
      "const observer = new observerCtor((records) => {",
      '  for (const record of records) record.target.setAttribute("aria-current", "location");',
      "});",
    ].join("\n");

    expect(ids(source, TS)).toEqual([]);
  });

  it("flags slides stepped from script", () => {
    expect(ids("track.scrollLeft += track.clientWidth;", TS)).toEqual(["forge-ui-platform-carousel"]);
  });

  it("flags a scroll height written back as a height", () => {
    expect(ids('area.style.height = area.scrollHeight + "px";', TS)).toEqual(["forge-ui-platform-field-sizing"]);
  });

  it("flags a measured rectangle written to a physical inset", () => {
    expect(ids('const rect = el.getBoundingClientRect();\npanel.style.top = rect.bottom + "px";', TS)).toEqual([
      "forge-ui-platform-anchor-positioning",
    ]);
  });

  it("does not flag a measured rectangle written to a custom property", () => {
    const source = ["const rect = el.getBoundingClientRect();", 'el.style.setProperty("--anchor-x", rect.left + "px");'].join("\n");

    expect(ids(source, TS)).toEqual([]);
  });
});

describe("findModernCssSourceViolations() — Tier C adoption", () => {
  it("flags a stylesheet that declares no layer", () => {
    expect(findModernCssSourceViolations(".a {\n  color: red;\n}\n", CSS)).toEqual([
      { file: CSS, line: 1, ruleId: "forge-ui-platform-layer", detail: "the stylesheet declares no `@layer` — order the cascade in named layers" },
    ]);
  });

  it("does not flag a stylesheet that declares one", () => {
    expect(ids("@layer base {\n  .a {\n    color: red;\n  }\n}\n", CSS)).toEqual([]);
  });

  it("flags a preprocessor stylesheet for being one", () => {
    expect(findModernCssSourceViolations("", "src/ui/a.scss")).toEqual([
      {
        file: "src/ui/a.scss",
        line: 1,
        ruleId: "forge-ui-platform-nesting",
        detail: "`.scss` compiles a nesting the browser now parses — author plain CSS with native nesting",
      },
    ]);
  });

  it("flags a viewport media query in a stylesheet with no container query", () => {
    expect(ids("@layer base;\n@media (min-width: 40rem) {\n  .a {\n    display: grid;\n  }\n}\n", CSS)).toEqual([
      "forge-ui-platform-container-query",
    ]);
  });

  it("flags a width query written in script", () => {
    expect(ids('const DEFAULT_QUERY = "(max-width: 47.99rem)";', TS)).toEqual(["forge-ui-platform-container-query"]);
  });

  it("flags a nested grid restating the parent's tracks", () => {
    const source = [
      "@layer base;",
      ".grid {",
      "  grid-template-columns: 1fr 2fr;",
      "}",
      ".grid .row {",
      "  grid-template-columns: 1fr 2fr;",
      "}",
    ].join("\n");

    expect(lines(source, CSS)).toEqual(["6 forge-ui-platform-subgrid"]);
  });

  it("flags a long selector list", () => {
    const source = ["@layer base;", ".a,", ".b,", ".c,", ".d {", "  color: red;", "}"].join("\n");

    expect(ids(source, CSS)).toEqual(["forge-ui-platform-selector-list"]);
  });

  it("does not flag a list already grouped with `:is()`", () => {
    expect(ids("@layer base;\n:is(.a, .b, .c, .d) {\n  color: red;\n}\n", CSS)).toEqual([]);
  });

  it("flags a hand-styled checkbox", () => {
    expect(ids("<input type='checkbox' class='size-4 appearance-none rounded border' />", TSX)).toEqual(["forge-ui-platform-accent-color"]);
  });

  it("does not flag a checkbox already tinted with an accent utility", () => {
    expect(ids("<input type='checkbox' class='size-4 appearance-none accent-primary' />", TSX)).toEqual([]);
  });

  it("flags a hand-styled checkbox whose type is a braced string literal", () => {
    const source = `<input type={"checkbox"} class='size-4 appearance-none rounded border' />`;
    expect(ids(source, TSX)).toEqual(["forge-ui-platform-accent-color"]);
    expect(findModernCssSourceViolations(source, TSX)[0]?.detail).toBe(
      'a hand-styled `<input type="checkbox">` — tint the native control with `accent-color`',
    );
  });

  it("flags a braced radio literal in single quotes or a template literal", () => {
    expect(ids("<input type={'radio'} class='appearance-none' />", TSX)).toEqual(["forge-ui-platform-accent-color"]);
    expect(ids("<input type={`checkbox`} class='appearance-none' />", TSX)).toEqual(["forge-ui-platform-accent-color"]);
  });

  it("does not flag a braced literal that is not checkable", () => {
    expect(ids(`<input type={"text"} class='appearance-none' />`, TSX)).toEqual([]);
  });

  it("does not flag a braced checkable literal already tinted with an accent utility", () => {
    expect(ids(`<input type={"checkbox"} class='appearance-none accent-primary' />`, TSX)).toEqual([]);
  });

  it("flags a hand-styled input whose type is a checkbox-or-radio binding, as a checkable factory writes it", () => {
    expect(lines(FACTORY, TSX)).toEqual(["2 forge-ui-platform-accent-color"]);
    expect(findModernCssSourceViolations(FACTORY, TSX)[0]?.detail).toBe(
      "a hand-styled `<input type={input}>` — tint the native control with `accent-color`",
    );
  });

  it("flags a binding typed as one optional checkable", () => {
    expect(ids("interface P { kind?: 'radio' }\nconst R = ({ kind }: P) => <input type={kind} class='appearance-none' />;\n", TSX)).toEqual([
      "forge-ui-platform-accent-color",
    ]);
  });

  it("does not flag a binding whose union admits a non-checkable type", () => {
    expect(ids(FACTORY.replace('"checkbox" | "radio"', '"checkbox" | "radio" | "text"'), TSX)).toEqual([]);
  });

  it("does not flag a checkable binding on an element that is not an input", () => {
    expect(ids(FACTORY.replace("<input", "<Choice"), TSX)).toEqual([]);
  });

  it("does not flag a checkable binding already tinted with an accent utility", () => {
    expect(ids(FACTORY.replace("appearance-none", "appearance-none accent-primary"), TSX)).toEqual([]);
  });

  it("honours an allow directive on the line above a bound type", () => {
    const source =
      'function group(input: "radio") {\n  return (\n    <input\n      /* modern-css-allow: forge-ui-platform-accent-color — the mark is redrawn. */\n      type={input}\n      class="appearance-none"\n    />\n  );\n}\n';

    expect(ids(source, TSX)).toEqual([]);
  });

  it("reports the shipped checkable group once its allow directive is removed", () => {
    const stripped = SHIPPED.replace(/\/\* modern-css-allow: forge-ui-platform-accent-color — [^*]*\*\//, "");

    expect(stripped).not.toBe(SHIPPED);
    expect(ids(stripped, "src/ui/core/checkable-group.tsx")).toEqual(["forge-ui-platform-accent-color"]);
  });

  it("keeps the shipped checkable group quiet through its allow directive", () => {
    expect(ids(SHIPPED, "src/ui/core/checkable-group.tsx")).toEqual([]);
  });

  it("flags a full-page swap with no view transition", () => {
    expect(ids('win.location.href = "/next";', TS)).toEqual(["forge-ui-platform-view-transition"]);
  });

  it("does not flag a swap already wrapped in a view transition", () => {
    expect(ids('doc.startViewTransition(() => {\n  win.location.href = "/next";\n});', TS)).toEqual([]);
  });

  it("flags a textarea with no `field-sizing-content`", () => {
    expect(ids("<textarea class='w-full rounded border' />", TSX)).toEqual(["forge-ui-platform-field-sizing-adopt"]);
  });

  it("does not flag a textarea that already sizes to its content", () => {
    expect(ids("<textarea class='w-full field-sizing-content rounded border' />", TSX)).toEqual([]);
  });

  it("flags a fixed max height standing in for an auto transition", () => {
    const source = ["@layer base;", ".panel {", "  transition: max-height 200ms;", "  max-height: 480px;", "}"].join("\n");

    expect(lines(source, CSS)).toEqual(["4 forge-ui-platform-interpolate-size"]);
  });

  it("does not flag it once the stylesheet allows the keyword", () => {
    const source = [
      "@layer base;",
      ":root {",
      "  interpolate-size: allow-keywords;",
      "}",
      ".panel {",
      "  transition: max-height 200ms;",
      "  max-height: 480px;",
      "}",
    ].join("\n");

    expect(ids(source, CSS)).toEqual([]);
  });

  it("flags a deeply prefixed selector family", () => {
    const source = ["@layer base;", ...["a", "b", "c", "d", "e"].map((name) => `.forge-menu-${name} {\n  color: red;\n}`)].join("\n");

    expect(ids(source, CSS)).toEqual(["forge-ui-platform-scope"]);
  });

  it("flags an attribute-free wrapper inside a flex parent", () => {
    const source = ["<div class='flex items-center gap-2'>", "  <div>", "    <Icon name='x' />", "  </div>", "</div>"].join("\n");

    expect(lines(source, TSX)).toEqual(["2 forge-ui-platform-display-contents"]);
  });

  it("does not flag a sibling element closed on its own line", () => {
    expect(ids("<div class='flex items-center gap-2'>\n  <span>Left</span>\n</div>", TSX)).toEqual([]);
  });

  it("flags a hand-written tint pair", () => {
    const source = ["@layer base;", ":root {", "  --surface: #ffffff;", "  --surface-hover: #f4f4f5;", "}"].join("\n");

    expect(lines(source, CSS)).toEqual(["4 forge-ui-platform-color-mix"]);
  });

  it("excludes a ring token, whose contrast floor a composited mix cannot hold", () => {
    const source = [
      "@layer base;",
      ":root {",
      "  --ring: #71717a;",
      "  --ring-hover: #52525b;",
      "  --border: #e4e4e7;",
      "  --border-hover: #d4d4d8;",
      "}",
    ].join("\n");

    expect(ids(source, CSS)).toEqual([]);
  });
});

describe("findModernCssSourceViolations() — open-state geometry", () => {
  it("flags a size keyed on `:popover-open` at the declaration's line", () => {
    const source = ["@layer base;", ".menu:popover-open {", "  inline-size: 20rem;", "}"].join("\n");

    expect(exit(source)).toEqual(["3 `inline-size`"]);
  });

  it("names the property, the state and the move in its detail", () => {
    const source = ["@layer base;", ".menu:popover-open {", "  inline-size: 20rem;", "}"].join("\n");

    expect(findModernCssSourceViolations(source, CSS)).toEqual([
      {
        file: CSS,
        line: 3,
        ruleId: "forge-ui-platform-exit-geometry",
        detail:
          "`inline-size` keyed on `:popover-open` collapses mid-exit, because the element stays painted through its exit fade after `:popover-open` stops matching — declare it on the base selector and key only `opacity`, `overlay` and `display` on the open state",
      },
    ]);
  });

  it("flags a nested `&:popover-open` rule", () => {
    const source = ["@layer base;", ".menu {", "  &:popover-open {", "    width: 20rem;", "  }", "}"].join("\n");

    expect(exit(source)).toEqual(["4 `width`"]);
  });

  it("flags an open-state rule inside `@media`", () => {
    const source = [
      "@layer base;",
      "@media (prefers-reduced-motion: no-preference) {",
      "  .menu:popover-open {",
      "    width: 20rem;",
      "  }",
      "}",
    ].join("\n");

    expect(exit(source)).toEqual(["4 `width`"]);
  });

  it("flags a selector list with one open-state member", () => {
    const source = ["@layer base;", ".a:popover-open, .b {", "  height: 10rem;", "}"].join("\n");

    expect(exit(source)).toEqual(["3 `height`"]);
  });

  it("flags every geometry family once", () => {
    const properties = [
      "width",
      "min-height",
      "max-inline-size",
      "inset-inline-start",
      "top",
      "margin-block",
      "padding",
      "position",
      "grid-template-columns",
      "translate",
      "transform",
      "scale",
      "rotate",
    ];
    const source = ["@layer base;", ".menu:popover-open {", ...properties.map((property) => `  ${property}: 0;`), "}"].join("\n");

    expect(exit(source)).toEqual(properties.map((property, offset) => `${offset + 3} \`${property}\``));
  });

  it("does not let a transition on another property exempt the geometry", () => {
    const source = ["@layer base;", ".menu {", "  transition: opacity 150ms;", "}", ".menu:popover-open {", "  width: 20rem;", "}"].join("\n");

    expect(exit(source)).toEqual(["6 `width`"]);
  });

  it("flags a size keyed on `[open]`", () => {
    const source = ["@layer base;", "dialog[open] {", "  max-block-size: 80vh;", "}"].join("\n");

    expect(exit(source)).toEqual(["3 `max-block-size`"]);
  });

  it("flags an `[open]` selector carrying a value", () => {
    const source = ["@layer base;", 'details[open=""] {', "  padding: 1rem;", "}"].join("\n");

    expect(exit(source)).toEqual(["3 `padding`"]);
  });

  it("flags a descendant of an open element", () => {
    const source = ["@layer base;", ".dialog[open] .panel {", "  padding: 1rem;", "}"].join("\n");

    expect(exit(source)).toEqual(["3 `padding`"]);
  });

  it("flags a nested `&[open]` rule", () => {
    const source = ["@layer base;", ".dialog {", "  &[open] {", "    margin: auto;", "  }", "}"].join("\n");

    expect(exit(source)).toEqual(["4 `margin`"]);
  });

  it("flags a non-modal placement keyed on `[open]` with no transition behind it", () => {
    const source = ["@layer base;", ".dialog[open]:not(:modal) {", "  position: static;", "  margin: 0;", "}"].join("\n");

    expect(exit(source)).toEqual(["3 `position`", "4 `margin`"]);
  });

  it("does not flag the properties the open state is meant to carry", () => {
    const source = [
      "@layer base;",
      ".menu:popover-open {",
      "  opacity: 1;",
      "  color: red;",
      "  background-color: white;",
      "  transition-duration: 150ms;",
      "  overlay: auto;",
      "  display: block;",
      "}",
    ].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("does not flag a colour keyed on `[open]`", () => {
    expect(exit(["@layer base;", "details[open] {", "  color: red;", "}"].join("\n"))).toEqual([]);
  });

  it("does not flag geometry keyed on the closed state", () => {
    expect(exit(["@layer base;", ".drawer:not([open]) {", "  translate: -100% 0;", "}"].join("\n"))).toEqual([]);
  });

  it("does not flag an open state that only scopes a sibling through `:has()`", () => {
    expect(exit(["@layer base;", ":has(> .content:popover-open) > .trigger {", "  padding: 1rem;", "}"].join("\n"))).toEqual([]);
  });

  it("does not flag look-alike attribute and class names", () => {
    const source = [
      "@layer base;",
      "[data-open] {",
      "  width: 1rem;",
      "}",
      "[data-open-modal] {",
      "  width: 1rem;",
      "}",
      ".popover-open {",
      "  width: 1rem;",
      "}",
    ].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("does not flag a starting style", () => {
    const source = ["@layer base;", "@starting-style {", "  .menu:popover-open {", "    translate: 0 -0.5rem;", "  }", "}"].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("does not flag a property the stylesheet transitions", () => {
    const source = ["@layer base;", ".menu {", "  transition: scale 150ms, opacity 150ms;", "}", ".menu:popover-open {", "  scale: 1;", "}"].join(
      "\n",
    );

    expect(exit(source)).toEqual([]);
  });

  it("treats a transitioned shorthand as covering its longhands", () => {
    const source = ["@layer base;", ".dialog {", "  transition: margin 150ms;", "}", ".dialog[open] {", "  margin-inline: auto;", "}"].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("treats `transition: all` as covering every property", () => {
    const source = ["@layer base;", ".menu {", "  transition: all 150ms;", "}", ".menu:popover-open {", "  height: 10rem;", "}"].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("does not flag a non-modal placement whose exit transitions it", () => {
    const source = [
      "@layer base;",
      ".dialog:not([open]) {",
      "  transition: position 150ms step-end allow-discrete, margin 150ms step-end allow-discrete;",
      "}",
      ".dialog[open]:not(:modal) {",
      "  position: static;",
      "  margin: 0;",
      "}",
    ].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("does not flag geometry on the base selector", () => {
    const source = ["@layer base;", ".menu {", "  inline-size: 20rem;", "}", ".menu:popover-open {", "  opacity: 1;", "}"].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("honours an allow directive on the line above", () => {
    const source = [
      "@layer base;",
      ".menu:popover-open {",
      "  /* modern-css-allow: forge-ui-platform-exit-geometry — the width change is the reveal */",
      "  width: 20rem;",
      "}",
    ].join("\n");

    expect(exit(source)).toEqual([]);
  });

  it("does not read a stylesheet rule out of a script file", () => {
    const source = ["const css = `", ".menu:popover-open {", "  width: 20rem;", "}", "`;"].join("\n");

    expect(ids(source, TS)).not.toContain("forge-ui-platform-exit-geometry");
  });

  it("does not flag a custom property", () => {
    expect(exit(["@layer base;", ".menu:popover-open {", "  --menu-width: 20rem;", "}"].join("\n"))).toEqual([]);
  });

  it("keeps forge's own stylesheet quiet", () => {
    expect(exit(SHIPPED_CSS)).toEqual([]);
  });
});
