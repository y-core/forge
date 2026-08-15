import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Toggle } from "./toggle";

const TOGGLE_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium " +
  "bg-transparent text-foreground border border-input cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring " +
  "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary " +
  "has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50";

describe("Toggle", () => {
  it("is a label wrapping a real checkbox, so it toggles and submits with no script", async () => {
    expect(await render(<Toggle>Bold</Toggle>)).toBe(
      `<label data-slot="toggle" class="${TOGGLE_CLASS}"><input data-slot="toggle-input" type="checkbox" class="sr-only">Bold</label>`,
    );
  });

  it("carries a server-rendered pressed state as the checkbox's own checkedness", async () => {
    expect(await render(<Toggle pressed>Bold</Toggle>)).toBe(
      `<label data-slot="toggle" class="${TOGGLE_CLASS}"><input data-slot="toggle-input" type="checkbox" class="sr-only" checked>Bold</label>`,
    );
  });

  it("puts name and value on the input, which is what makes it appear in a submission", async () => {
    expect(await render(<Toggle name='bold' value='on' pressed />)).toBe(
      `<label data-slot="toggle" class="${TOGGLE_CLASS}">` +
        '<input data-slot="toggle-input" type="checkbox" class="sr-only" checked name="bold" value="on"></label>',
    );
  });

  it("names no scope and no action: there is no state left for a controller to maintain", async () => {
    const html = await render(<Toggle>Bold</Toggle>);

    expect(html).not.toContain("data-scope");
    expect(html).not.toContain("data-on-click");
    expect(html).not.toContain("aria-pressed");
  });

  it("disables through the input, which the label's has-[:disabled] hooks paint from", async () => {
    expect(await render(<Toggle disabled>Bold</Toggle>)).toBe(
      `<label data-slot="toggle" class="${TOGGLE_CLASS}"><input data-slot="toggle-input" type="checkbox" class="sr-only" disabled>Bold</label>`,
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<Toggle data-slot='rail-tool' />)).toBe(
      `<label data-slot="toggle" class="${TOGGLE_CLASS}"><input data-slot="toggle-input rail-tool" type="checkbox" class="sr-only"></label>`,
    );
  });

  it("merges a caller class onto the base and escapes children", async () => {
    expect(await render(<Toggle class='w-full'>{`R&D's <bold>`}</Toggle>)).toBe(
      `<label data-slot="toggle" class="${TOGGLE_CLASS} w-full">` +
        '<input data-slot="toggle-input" type="checkbox" class="sr-only">R&amp;D&#39;s &lt;bold&gt;</label>',
    );
  });
});
