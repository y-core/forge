import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Button, buttonBox } from "./button";
import { Toggle } from "./toggle";
import { ToggleGroup } from "./toggle-group";

const INPUT = 'data-slot="toggle-input"';

const toggle = (props: Parameters<typeof Toggle>[0] = {}) => render(<Toggle {...props} />);
const textNodes = (html: string) => html.split(/<[^>]+>/).filter(Boolean);

describe("Toggle", () => {
  it("renders the whole control exactly, caller class merged last and children escaped", async () => {
    expect(await render(<Toggle class='w-full'>{`R&D's <bold>`}</Toggle>)).toBe(
      '<label data-slot="toggle" data-size="md" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field' +
        " border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md px-4 text-sm state-invalid" +
        " border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground has-[:checked]:bg-primary" +
        ' has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary cursor-pointer w-full"><input data-slot="toggle-input" type="checkbox" class="sr-only">R&amp;D&#39;s &lt;bold&gt;</label>',
    );
  });

  it("is a label wrapping a real checkbox, naming no scope and no action: nothing is left for a controller to keep", async () => {
    const html = await render(<Toggle>Bold</Toggle>);

    expect(tagOf(html).startsWith("<label ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "toggle", "data-size": "md" });
    expect(attrsOf(html, INPUT)).toEqual({ "data-slot": "toggle-input", type: "checkbox" });
    expect(textNodes(html)).toEqual(["Bold"]);
  });

  it("keeps the input sr-only rather than hidden, so it stays focusable and stays in the submission", async () => {
    expect(classesOf(await toggle(), INPUT)).toEqual(["sr-only"]);
  });

  it("carries a server-rendered pressed state as the checkbox's own checkedness and nothing else", async () => {
    expect(attrsOf(await toggle({ pressed: true }), INPUT)).toEqual({ "data-slot": "toggle-input", type: "checkbox", checked: "" });
  });

  it("puts name and value on the input, which is what makes it appear in a submission", async () => {
    expect(attrsOf(await toggle({ name: "bold", value: "on", pressed: true }), INPUT)).toEqual({
      "data-slot": "toggle-input",
      type: "checkbox",
      checked: "",
      name: "bold",
      value: "on",
    });
  });

  it("disables through the input, which the label's has-[:disabled] hooks paint from", async () => {
    expect(attrsOf(await toggle({ disabled: true }), INPUT)).toEqual({ "data-slot": "toggle-input", type: "checkbox", disabled: "" });
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(attrOf(await toggle({ "data-slot": "rail-tool" }), "data-slot", 'type="checkbox"')).toBe("toggle-input rail-tool");
  });
});

describe("Toggle — size, invalid and busy", () => {
  it("stamps the size it was given, so a stylesheet and a reader both read it off the label", async () => {
    const sizes = await Promise.all((["sm", "md", "lg"] as const).map((size) => toggle({ size })));

    expect(sizes.map((html) => attrOf(html, "data-size"))).toEqual(["sm", "md", "lg"]);
  });

  it("moves the control height and padding with Button's size scale", async () => {
    expect(variantClasses(await toggle({ size: "sm" }), await toggle())).toEqual({
      added: ["h-control-sm", "px-3"],
      dropped: ["h-control-md", "px-4"],
    });
    expect(variantClasses(await toggle({ size: "lg" }), await toggle())).toEqual({
      added: ["h-control-lg", "px-6", "text-base"],
      dropped: ["h-control-md", "px-4", "text-sm"],
    });
  });

  it("Toggle's box is Button's box at every size", async () => {
    const sizes = ["sm", "md", "lg"] as const;
    const boxes = sizes.map((size) => buttonBox({ size }).split(" "));
    const toggles = await Promise.all(sizes.map((size) => toggle({ size })));

    expect(toggles.map((html, i) => classesOf(html).slice(0, boxes[i]?.length))).toEqual(boxes);
  });

  it("invalid stamps data-invalid beside aria-invalid on the input", async () => {
    expect(attrsOf(await toggle({ invalid: true }), INPUT)).toEqual({
      "data-slot": "toggle-input",
      type: "checkbox",
      "data-invalid": "",
      "aria-invalid": "true",
    });
  });

  it("busy stamps data-busy beside aria-busy on the input", async () => {
    expect(attrsOf(await toggle({ busy: true }), INPUT)).toEqual({
      "data-slot": "toggle-input",
      type: "checkbox",
      "data-busy": "",
      "aria-busy": "true",
    });
  });
});

describe("the neutral control border comes from border-field, not a hand-written width", () => {
  const widths = (html: string): string[] => classesOf(html).filter((token) => token === "border" || token === "border-field");

  it("holds for Toggle, ToggleGroup.Item and a neutral outline Button alike, so a compact theme moves all three", async () => {
    expect([
      widths(await render(<Toggle />)),
      widths(await render(<ToggleGroup.Item name='g' value='a' />)),
      widths(await render(<Button tone='neutral' appearance='outline' />)),
    ]).toEqual([["border-field"], ["border-field"], ["border-field"]]);
  });
});
