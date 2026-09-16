import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, variantClasses } from "./test-support";
import { Textarea } from "./textarea";

const area = (props: Parameters<typeof Textarea>[0] = {}) => render(<Textarea {...props} />);

describe("Textarea", () => {
  it("renders the whole control exactly, with its initial text escaped", async () => {
    expect(await render(<Textarea>{`R&D's <x>`}</Textarea>)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome' +
        ' h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm">R&amp;D&#39;s &lt;x&gt;</textarea>',
    );
  });

  it("carries nothing but its slot and its size until it is given something", async () => {
    expect(attrsOf(await area())).toEqual({ "data-slot": "textarea", "data-size": "md" });
  });

  it("sizes to its content between a floor and a ceiling, and stays resizable by hand", async () => {
    expect(classesOf(await area()).filter((token) => token.startsWith("field-sizing") || token.includes("h-") || token === "resize-y")).toEqual([
      "field-sizing-content",
      "h-auto",
      "max-h-64",
      "min-h-16",
      "resize-y",
    ]);
  });

  it("passes native authoring attributes straight through: id, name, rows and placeholder", async () => {
    expect(attrsOf(await area({ id: "msg", name: "message", rows: 5, placeholder: "Your message" }))).toEqual({
      "data-slot": "textarea",
      "data-size": "md",
      id: "msg",
      name: "message",
      rows: "5",
      placeholder: "Your message",
    });
  });

  it("passes required and disabled through as the bare attributes a browser enforces", async () => {
    expect(attrsOf(await area({ required: true, disabled: true }))).toEqual({
      "data-slot": "textarea",
      "data-size": "md",
      required: "",
      disabled: "",
    });
  });

  it("passes a caller's own ARIA through, so a field can point the control at its error text", async () => {
    expect(attrsOf(await area({ "aria-describedby": "desc", "aria-invalid": "true" }))).toEqual({
      "data-slot": "textarea",
      "data-size": "md",
      "aria-describedby": "desc",
      "aria-invalid": "true",
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await area({ class: "extra" })).at(-1)).toBe("extra");
  });
});

describe("Textarea — size, invalid and busy", () => {
  it("stamps the size it was given, so a stylesheet and a reader both read it off the control", async () => {
    const sizes = await Promise.all((["sm", "md", "lg"] as const).map((size) => area({ size })));

    expect(sizes.map((html) => attrOf(html, "data-size"))).toEqual(["sm", "md", "lg"]);
  });

  it("steps only the type size, because a textarea's height is its content's rather than its Size", async () => {
    expect(variantClasses(await area({ size: "sm" }), await area())).toEqual({ added: [], dropped: [] });
    expect(variantClasses(await area({ size: "lg" }), await area())).toEqual({ added: ["text-base"], dropped: ["text-sm"] });
  });

  it("invalid stamps data-invalid beside aria-invalid", async () => {
    expect(attrsOf(await area({ invalid: true }))).toEqual({
      "data-slot": "textarea",
      "data-size": "md",
      "data-invalid": "",
      "aria-invalid": "true",
    });
  });

  it("busy stamps data-busy beside aria-busy", async () => {
    expect(attrsOf(await area({ busy: true }))).toEqual({ "data-slot": "textarea", "data-size": "md", "data-busy": "", "aria-busy": "true" });
  });

  it("keeps state-invalid when the caller supplies a ring of their own, which once silently deleted it", async () => {
    expect(variantClasses(await area({ class: "ring-primary" }), await area())).toEqual({ added: ["ring-primary"], dropped: [] });
  });
});
