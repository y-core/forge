import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrsOf, classesOf, variantClasses } from "./core.fixture";
import { Status } from "./status";

const dot = (props: Omit<Parameters<typeof Status>[0], "label"> = {}) => render(<Status label='Idle' {...props} />);

describe("Status", () => {
  it("renders the whole dot exactly, its label escaped and the caller class merged last", async () => {
    expect(await render(<Status label={`R&D's`} class='ring-2' />)).toBe(
      '<span role="img" aria-label="R&amp;D&#39;s" data-slot="status" data-tone="neutral" class="[--tone:var(--color-foreground)]' +
        " [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)]" +
        " [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] inline-block rounded-selector" +
        ' bg-(--tone) size-2.5 ring-2"></span>',
    );
  });

  it("carries its whole meaning in an accessible name, since a coloured dot announces nothing on its own", async () => {
    expect(attrsOf(await dot())).toEqual({ role: "img", "aria-label": "Idle", "data-slot": "status", "data-tone": "neutral" });
  });

  it("names the tone it was given on the attribute a stylesheet and a reader both key on", async () => {
    expect(attrsOf(await dot({ tone: "success" }))).toEqual({ role: "img", "aria-label": "Idle", "data-slot": "status", "data-tone": "success" });
  });

  it("swaps the whole tone palette rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await dot({ tone: "success" }), await dot());

    expect(added.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(dropped.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("exchanges one size class at lg rather than stacking a second diameter", async () => {
    expect(variantClasses(await dot({ size: "lg" }), await dot())).toEqual({ added: ["size-3"], dropped: ["size-2.5"] });
  });

  it("exchanges one size class at sm rather than stacking a second diameter", async () => {
    expect(variantClasses(await dot({ size: "sm" }), await dot())).toEqual({ added: ["size-2"], dropped: ["size-2.5"] });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await dot({ class: "ring-2" })).at(-1)).toBe("ring-2");
  });

  it("forwards an id and a data attribute, with the value escaped", async () => {
    expect(attrsOf(await dot({ id: "s1", "data-note": "a&b" }))).toEqual({
      role: "img",
      "aria-label": "Idle",
      "data-slot": "status",
      "data-tone": "neutral",
      id: "s1",
      "data-note": "a&amp;b",
    });
  });

  it("composes an inherited slot token after its own, so both stylesheets still reach it", async () => {
    expect(attrsOf(await dot({ "data-slot": "inherited" }))).toEqual({
      role: "img",
      "aria-label": "Idle",
      "data-slot": "status inherited",
      "data-tone": "neutral",
    });
  });
});
