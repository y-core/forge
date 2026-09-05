import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Button } from "./button";
import { Toggle } from "./toggle";
import { ToggleGroup } from "./toggle-group";

const attrNames = (html: string, tag: string): string[] =>
  [...(new RegExp(`<${tag}\\s([^>]*)>`).exec(html)?.[1] ?? "").matchAll(/(?:^|\s)([\w:-]+)=/g)].map((m) => m[1] as string);

describe("Toggle", () => {
  it("is a label wrapping a real checkbox, so it toggles and submits with no script", async () => {
    expect(await render(<Toggle>Bold</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only">Bold</label>',
    );
  });

  it("carries a server-rendered pressed state as the checkbox's own checkedness", async () => {
    expect(await render(<Toggle pressed>Bold</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only" checked>Bold</label>',
    );
  });

  it("puts name and value on the input, which is what makes it appear in a submission", async () => {
    expect(await render(<Toggle name='bold' value='on' pressed />)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only" checked name="bold" value="on"></label>',
    );
  });

  it("names no scope and no action: there is no state left for a controller to maintain", async () => {
    const html = await render(<Toggle>Bold</Toggle>);

    expect(attrNames(html, "label")).toEqual(["data-slot", "data-size", "class"]);
    expect(attrNames(html, "input")).toEqual(["data-slot", "type", "class"]);
  });

  // No `data-pressed` and no `aria-pressed`: the input is a real checkbox, so `:checked` is the
  // state, and the label's own `has-[:checked]` hooks are what paint from it.
  it("carries the pressed state as the input's checkedness and nothing else, on both renders", async () => {
    expect(await render(<Toggle pressed>Bold</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only" checked>Bold</label>',
    );
    expect(await render(<Toggle>Bold</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only">Bold</label>',
    );
  });

  it("disables through the input, which the label's has-[:disabled] hooks paint from", async () => {
    expect(await render(<Toggle disabled>Bold</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only" disabled>Bold</label>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<Toggle data-slot='rail-tool' />)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input rail-tool" type="checkbox" class="sr-only"></label>',
    );
  });

  it("merges a caller class onto the base and escapes children", async () => {
    expect(await render(<Toggle class='w-full'>{`R&D's <bold>`}</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm w-full"><input data-slot="toggle-input" type="checkbox" class="sr-only">R&amp;D&#39;s &lt;bold&gt;</label>',
    );
  });
});

describe("Toggle — size, invalid and busy", () => {
  it("stamps data-size=md and the md control height by default", async () => {
    expect(await render(<Toggle />)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only"></label>',
    );
  });

  it("size='sm' stamps data-size=sm and the sm control height", async () => {
    expect(await render(<Toggle size='sm' />)).toBe(
      '<label data-slot="toggle" data-size="sm" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-sm text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only"></label>',
    );
  });

  it("size='lg' stamps data-size=lg and the lg control height", async () => {
    expect(await render(<Toggle size='lg' />)).toBe(
      '<label data-slot="toggle" data-size="lg" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-lg text-base"><input data-slot="toggle-input" type="checkbox" class="sr-only"></label>',
    );
  });

  it("invalid stamps data-invalid beside aria-invalid on the input", async () => {
    expect(await render(<Toggle invalid />)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only" data-invalid="" aria-invalid="true"></label>',
    );
  });

  it("busy stamps data-busy beside aria-busy on the input", async () => {
    expect(await render(<Toggle busy />)).toBe(
      '<label data-slot="toggle" data-size="md" class="inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm"><input data-slot="toggle-input" type="checkbox" class="sr-only" data-busy="" aria-busy="true"></label>',
    );
  });
});

// The neutral border is one token, not a width each component spells for itself: a `border` beside
// `border-field` pins 1px and ignores `--border-width`, so a compact theme moved four controls and
// left these two behind.
describe("the neutral control border comes from border-field, not a hand-written width", () => {
  const widths = (html: string): string[] =>
    (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ").filter((token) => token === "border" || token === "border-field");

  it("holds for Toggle, ToggleGroup.Item and a neutral outline Button alike", async () => {
    expect([
      widths(await render(<Toggle />)),
      widths(await render(<ToggleGroup.Item name='g' value='a' />)),
      widths(await render(<Button tone='neutral' appearance='outline' />)),
    ]).toEqual([["border-field"], ["border-field"], ["border-field"]]);
  });
});
