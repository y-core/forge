import { describe, expect, it } from "bun:test";
import { findSlotClobbers } from "./jsx-parse";

// Every fixture below is an inline string rather than a file on disk. That is the reason the parse
// module was split out of the validator at all: `validate-jsx.ts` walks the whole of `src/`, so a
// `.tsx` fixture written to deliberately trip the rule would fail the very gate it exists to test.
// A string means no such file exists anywhere for the walk to find.
//
// `scripts/` is neither linted nor typechecked by the gate, so this table is the only safety net
// this scanner has.

/** `tag:slot:spread` per finding — the whole object is noise where only the pairing is at issue. */
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
    // An allowlist of `rest`/`props` would miss the other three outright.
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
    // The attribute is the position worth pointing a reader at: it is the line they must edit.
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
    // Modelled on `src/ui/core/utils/as-child.ts:78`, whose TSDoc quotes a `[data-slot="…"]`
    // selector in running prose. A regex sees an attribute there; the scanner sees a comment.
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
    // Modelled on `src/ui/core/field.tsx`'s `[&>[data-slot~=field-label]]` variant strings. This is
    // the critical case: misreading that `>` desynchronises the scan and the failure mode is
    // *finding fewer things*, so only a positive assertion after the hazard can catch it.
    const source = [
      '<div class={cn("[&>[data-slot~=field-label]]:flex-auto")} data-slot="field" />',
      "<label data-slot='field-label' {...props} />",
    ].join("\n");

    expect(findSlotClobbers(source)).toEqual([{ line: 2, slot: "field-label", spread: "props", tag: "label" }]);
  });

  it("treats a nested element inside a braced attribute as its own site, leaking no attributes either way", () => {
    // The inner element closes first, so it is reported first.
    const source = "<div data-slot='outer' icon={<Icon data-slot='inner' {...iprops} />} {...rest} />";

    expect(findSlotClobbers(source)).toEqual([
      { line: 1, slot: "inner", spread: "iprops", tag: "Icon" },
      { line: 1, slot: "outer", spread: "rest", tag: "div" },
    ]);
  });

  it("terminates a tag on a plain `>` exactly as it does on a self-closing `/>`", () => {
    // Self-closing: the spread is inside the tag and clobbers.
    expect(clobbers("<div data-slot='a' {...rest} />")).toEqual(["div:a:rest"]);
    // Plain `>`: same, with children following.
    expect(clobbers("<div data-slot='a' {...rest}>text</div>")).toEqual(["div:a:rest"]);
    // Plain `>` closes the tag, so a spread in the children belongs to no element's attributes.
    expect(findSlotClobbers("<div data-slot='a'>{...rest}</div>")).toEqual([]);
  });

  it("does not mistake a TypeScript generic for an element, nor let it swallow the real one", () => {
    const source = "const C: FC<CardProps> = ({ ...rest }) => (<div data-slot='card' {...rest} />);";

    expect(findSlotClobbers(source)).toEqual([{ line: 1, slot: "card", spread: "rest", tag: "div" }]);
  });
});

describe("findSlotClobbers() — accepted imprecision (pinned so a change is deliberate)", () => {
  it("does not report a conditional wrapping the rest object, the false negative the module header documents", () => {
    // `{...(cond ? rest : {})}` genuinely can carry a caller's token, and it reads as a computed
    // expression, so it is skipped. The trade is accepted only because the repository has zero
    // occurrences of the shape today. This assertion is a pin, not an endorsement: were this to
    // start finding the site, that would be a deliberate widening and this test the place to argue
    // it — it is not a bug to be fixed silently.
    expect(findSlotClobbers("<div data-slot='card' {...(cond ? rest : {})} />")).toEqual([]);
  });
});
