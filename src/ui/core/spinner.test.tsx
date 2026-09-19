import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { createIcon } from "./icon";
import { Spinner } from "./spinner";

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 24 24" });

const busy = (props: Omit<Parameters<typeof Spinner>[0], "icon"> = {}) => render(<Spinner icon={icon} {...props} />);

const statusText = (html: string) => /<span[^>]*>([^<]*)<\/span><\/span>$/.exec(html)?.[1];

describe("Spinner", () => {
  it("renders the whole indicator exactly, forwarded attributes and label escaped", async () => {
    expect(await render(<Spinner icon={icon} label={`R&D's`} id='sp1' data-note='a&b' />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center" id="sp1" data-note="a&amp;b">' +
        '<svg data-slot="icon" viewBox="0 0 24 24" class="motion-safe:animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg>' +
        '<span class="sr-only motion-reduce:not-sr-only">R&amp;D&#39;s</span></span>',
    );
  });

  it("announces itself as a live status region, so the spin is not the only signal that work is running", async () => {
    expect(attrsOf(await busy())).toEqual({ "data-slot": "spinner", role: "status" });
  });

  it("carries a default label, because a status region with no name announces nothing", async () => {
    expect(statusText(await busy())).toBe("Loading…");
  });

  it("names the work being waited on when the caller says what it is", async () => {
    expect(statusText(await busy({ label: "Processing…" }))).toBe("Processing…");
  });

  it("scales the glyph alone at the sm and lg sizes, leaving the wrapper's layout untouched", async () => {
    const baseline = await busy();

    expect(variantClasses(await busy({ size: "sm" }), baseline, 'data-slot="icon"')).toEqual({ added: ["size-4"], dropped: ["size-6"] });
    expect(variantClasses(await busy({ size: "lg" }), baseline, 'data-slot="icon"')).toEqual({ added: ["size-8"], dropped: ["size-6"] });
    expect(variantClasses(await busy({ size: "sm" }), baseline)).toEqual({ added: [], dropped: [] });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await busy({ class: "my-spinner" })).at(-1)).toBe("my-spinner");
  });
});
