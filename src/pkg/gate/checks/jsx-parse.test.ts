import { describe, expect, it } from "bun:test";
import { findSlotClobbers } from "./jsx-parse";

function clobbers(source: string): string[] {
  return findSlotClobbers(source).map((c) => `${c.tag}:${c.slot}:${c.spread}`);
}

describe("findSlotClobbers() — the clobbering shape (what the rule exists to catch)", () => {
  it("reports a literal data-slot followed by a bare rest spread, the shape that hands a caller an eraser", () => {
    expect(clobbers("<div data-slot='card' {...rest} />")).toEqual(["div:card:rest"]);
  });

  it("reads a double-quoted literal as well as a single-quoted one, since both are written in this repo", () => {
    expect(clobbers('<div data-slot="card" {...rest} />')).toEqual(["div:card:rest"]);
  });

  it("reports any bare identifier rather than an allowlist of names, because the repo spreads all of these", () => {
    expect(clobbers("<div data-slot='a' {...rest} />")).toEqual(["div:a:rest"]);
    expect(clobbers("<div data-slot='a' {...props} />")).toEqual(["div:a:props"]);
    expect(clobbers("<div data-slot='a' {...attrs} />")).toEqual(["div:a:attrs"]);
    expect(clobbers("<div data-slot='a' {...resolved} />")).toEqual(["div:a:resolved"]);
    expect(clobbers("<div data-slot='a' {...formProps} />")).toEqual(["div:a:formProps"]);
  });

  it("reports a component tag as written, so `Menu.Item` is not truncated to `Menu`", () => {
    expect(findSlotClobbers("<Menu.Item data-slot='menu-item' {...rest} />")).toEqual([
      { line: 1, slot: "menu-item", spread: "rest", tag: "Menu.Item" },
    ]);
  });

  it("points the line at the data-slot attribute, not at the tag or the spread, on a multi-line tag", () => {
    const source = [
      "export function Card(props: Props) {",
      "  return (",
      "    <div",
      '      class="card"',
      '      data-slot="card"',
      "      {...props}",
      "    />",
      "  );",
      "}",
    ].join("\n");

    expect(findSlotClobbers(source)).toEqual([{ line: 5, slot: "card", spread: "props", tag: "div" }]);
  });

  it("reports one finding per element, because a second clobbering spread on the same tag says nothing new", () => {
    expect(clobbers("<div data-slot='card' {...rest} {...props} {...attrs} />")).toEqual(["div:card:rest"]);
  });

  it("reports two separate qualifying elements in source order", () => {
    const source = ["<div data-slot='one' {...rest} />", "<span data-slot='two' {...props} />"].join("\n");

    expect(findSlotClobbers(source)).toEqual([
      { line: 1, slot: "one", spread: "rest", tag: "div" },
      { line: 2, slot: "two", spread: "props", tag: "span" },
    ]);
  });
});

describe("findSlotClobbers() — the shapes that are not clobbering (what must stay quiet)", () => {
  it("exempts the migrated braced shape by construction, since a merge helper surrenders nothing", () => {
    expect(findSlotClobbers('<div data-slot={slotToken("card", inherited)} {...rest} />')).toEqual([]);
  });

  it("skips a computed spread, whose contents the component built and no caller token can hide in", () => {
    expect(findSlotClobbers("<div data-slot='a' {...stateAttrs({ open })} />")).toEqual([]);
    expect(findSlotClobbers("<div data-slot='a' {...scopeAttrs<ToggleAction>({ onClick: \"toggle\" })} />")).toEqual([]);
    expect(findSlotClobbers("<div data-slot='a' {...(open ? { open } : {})} />")).toEqual([]);
    expect(findSlotClobbers("<div data-slot='a' {...foo()} />")).toEqual([]);
    expect(findSlotClobbers("<div data-slot='a' {...a.b} />")).toEqual([]);
  });

  it("skips a spread standing before the literal, because the literal wins there", () => {
    expect(findSlotClobbers("<div {...rest} data-slot='card' />")).toEqual([]);
  });

  it("skips a literal with no spread at all on the element", () => {
    expect(findSlotClobbers("<div data-slot='card' class='p-4' />")).toEqual([]);
  });

  it("skips a data-slot inside a line comment, which is prose and not an attribute", () => {
    expect(findSlotClobbers("// <div data-slot='card' {...rest} />")).toEqual([]);
  });

  it("skips a data-slot inside a block comment, the near-miss a regex implementation fails", () => {
    // A `[data-slot="…"]` selector quoted inside a TSDoc comment, which a regex reads as an attribute.
    const source = [
      "/**",
      ' * A consumer keying on `[data-slot="menu-trigger"]` exactly must do the same,',
      " * even when the element also takes {...rest}.",
      " */",
      "export const x = 1;",
    ].join("\n");

    expect(findSlotClobbers(source)).toEqual([]);
  });

  it("skips a data-slot inside a string literal, which names a selector rather than writing an attribute", () => {
    expect(findSlotClobbers('const sel = \'[data-slot="card"]\'; const s2 = "{...rest}";')).toEqual([]);
  });
});

describe("findSlotClobbers() — structural hazards (why it is a scanner and not a regex)", () => {
  it("does not read a `>` inside a quoted string inside a braced attribute as the tag terminator", () => {
    // A `>` inside a variant string: misreading it desynchronises the scan, and the failure mode is
    // finding fewer things, so only a positive assertion after the hazard catches it.
    const source = [
      '<div class={cn("[&>[data-slot~=field-label]]:flex-auto")} data-slot="field" />',
      "<label data-slot='field-label' {...props} />",
    ].join("\n");

    expect(findSlotClobbers(source)).toEqual([{ line: 2, slot: "field-label", spread: "props", tag: "label" }]);
  });

  it("treats a nested element inside a braced attribute as its own site, leaking no attributes either way", () => {
    const source = "<div data-slot='outer' icon={<Icon data-slot='inner' {...iprops} />} {...rest} />";

    expect(findSlotClobbers(source)).toEqual([
      { line: 1, slot: "inner", spread: "iprops", tag: "Icon" },
      { line: 1, slot: "outer", spread: "rest", tag: "div" },
    ]);
  });

  it("terminates a tag on a plain `>` exactly as it does on a self-closing `/>`", () => {
    expect(clobbers("<div data-slot='a' {...rest} />")).toEqual(["div:a:rest"]);
    expect(clobbers("<div data-slot='a' {...rest}>text</div>")).toEqual(["div:a:rest"]);
    expect(findSlotClobbers("<div data-slot='a'>{...rest}</div>")).toEqual([]);
  });

  it("does not mistake a TypeScript generic for an element, nor let it swallow the real one", () => {
    const source = "const C: FC<CardProps> = ({ ...rest }) => (<div data-slot='card' {...rest} />);";

    expect(findSlotClobbers(source)).toEqual([{ line: 1, slot: "card", spread: "rest", tag: "div" }]);
  });
});

describe("findSlotClobbers() — accepted imprecision (pinned so a change is deliberate)", () => {
  it("does not report a spread whose rest object is behind a conditional expression", () => {
    expect(findSlotClobbers("<div data-slot='card' {...(cond ? rest : {})} />")).toEqual([]);
  });
});
