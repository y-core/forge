import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Kbd } from "./kbd";

const key = (props: Parameters<typeof Kbd>[0] = {}) => render(<Kbd {...props}>K</Kbd>);

describe("Kbd", () => {
  it("renders the whole key exactly, its legend and a forwarded value both escaped", async () => {
    expect(
      await render(
        <Kbd id='k1' data-note='a&b'>
          {`R&D's`}
        </Kbd>,
      ),
    ).toBe(
      '<kbd data-slot="kbd" class="inline-flex items-center rounded-field border-field border-border bg-muted font-mono font-medium' +
        ' text-foreground shadow-xs px-1.5 py-0.5 text-xs" id="k1" data-note="a&amp;b">R&amp;D&#39;s</kbd>',
    );
  });

  it("names itself with a slot and stamps no other attribute, leaving the rest to the caller", async () => {
    expect(attrsOf(await key())).toEqual({ "data-slot": "kbd" });
  });

  it("tightens the padding and drops a type step at sm, which nothing but the classes says", async () => {
    expect(variantClasses(await key({ size: "sm" }), await key())).toEqual({
      added: ["px-1", "py-px", "text-[0.6875rem]"],
      dropped: ["px-1.5", "py-0.5", "text-xs"],
    });
  });

  it("loosens the padding and gains a type step at lg, which nothing but the classes says", async () => {
    expect(variantClasses(await key({ size: "lg" }), await key())).toEqual({
      added: ["px-2", "py-1", "text-sm"],
      dropped: ["px-1.5", "py-0.5", "text-xs"],
    });
  });

  it("lets a caller's padding evict the size padding rather than emit both", async () => {
    expect(variantClasses(await key({ class: "p-2" }), await key())).toEqual({ added: ["p-2"], dropped: ["px-1.5", "py-0.5"] });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await key({ class: "p-2" })).at(-1)).toBe("p-2");
  });

  it("composes an inherited slot token after its own, so both stylesheets still reach it", async () => {
    expect(attrsOf(await key({ "data-slot": "inherited" }))).toEqual({ "data-slot": "kbd inherited" });
  });
});
