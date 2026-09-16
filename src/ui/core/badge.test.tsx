import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Badge } from "./badge";
import { attrsOf, classesOf, variantClasses } from "./test-support";

const chip = (props: Parameters<typeof Badge>[0] = {}) => render(<Badge {...props}>New</Badge>);

describe("Badge", () => {
  it("renders the whole chip exactly, caller class merged last and children escaped", async () => {
    expect(await render(<Badge class='uppercase'>{`R&D's`}</Badge>)).toBe(
      '<span data-slot="badge" data-tone="neutral" data-appearance="soft" class="inline-flex items-center rounded-selector border-field' +
        " font-medium px-2.5 py-0.5 text-xs [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)]" +
        " [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)]" +
        " [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg)" +
        ' [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] uppercase">R&amp;D&#39;s</span>',
    );
  });

  it("stamps both axes as attributes, so a variant is readable without reading a class list", async () => {
    expect(attrsOf(await chip())).toEqual({ "data-slot": "badge", "data-tone": "neutral", "data-appearance": "soft" });
  });

  it("names the tone it was given on the attribute a stylesheet and a reader both key on", async () => {
    expect(attrsOf(await chip({ tone: "warning", appearance: "solid" }))).toEqual({
      "data-slot": "badge",
      "data-tone": "warning",
      "data-appearance": "solid",
    });
  });

  it("swaps the whole tone palette rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await chip({ tone: "primary" }), await chip());

    expect(added.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(dropped.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("gives the solid appearance its own fill and evicts the soft one it conflicts with", async () => {
    expect(variantClasses(await chip({ appearance: "solid" }), await chip())).toEqual({
      added: [
        "border-transparent",
        "bg-(--tone)",
        "text-(--tone-fg)",
        "[--focus-ring:var(--tone-fg)]",
        "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
      ],
      dropped: [
        "border-(--tone-soft-border)",
        "bg-(--tone-soft)",
        "text-(--tone-soft-fg)",
        "[--focus-ring:var(--color-ring)]",
        "hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]",
      ],
    });
  });

  it("gives the outline appearance a border in the tone's own text colour and no fill", async () => {
    const { added } = variantClasses(await chip({ appearance: "outline" }), await chip());

    expect(added).toEqual(["border-(--tone-text)", "bg-transparent", "text-(--tone-text)", "hover:bg-(--tone-soft)"]);
  });

  it("tightens the padding and drops a type step at the sm size, which nothing but the classes says", async () => {
    expect(variantClasses(await chip({ size: "sm" }), await chip())).toEqual({
      added: ["px-2", "py-px", "text-[0.6875rem]"],
      dropped: ["px-2.5", "py-0.5", "text-xs"],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Badge class='uppercase'>New</Badge>)).at(-1)).toBe("uppercase");
  });

  it("forwards an id and a data attribute, with the value escaped", async () => {
    expect(
      attrsOf(
        await render(
          <Badge id='b1' data-note='a&b'>
            x
          </Badge>,
        ),
      ),
    ).toEqual({ "data-slot": "badge", "data-tone": "neutral", "data-appearance": "soft", id: "b1", "data-note": "a&amp;b" });
  });
});
