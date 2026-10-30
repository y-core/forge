/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import type { JSXNode } from "../../render/jsx/types";
import { attrsOf, classesOf, tagOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { createDialogParts } from "./dialog-parts";
import { PANEL_FOOTER, PANEL_HEADER } from "./utils/recipes";

for (const prefix of ["dialog", "drawer"] as const) {
  describe(`createDialogParts("${prefix}")`, () => {
    const parts = createDialogParts(prefix, "px-6 overflow-y-auto");

    const slotted: { part: string; node: (slot?: string) => JSXNode }[] = [
      { part: "trigger", node: (slot) => <parts.Trigger for='x' data-slot={slot} /> },
      { part: "close", node: (slot) => <parts.Close for='x' data-slot={slot} /> },
      { part: "title", node: (slot) => <parts.Title for='x' data-slot={slot} /> },
      { part: "description", node: (slot) => <parts.Description for='x' data-slot={slot} /> },
      { part: "header", node: (slot) => <parts.Header data-slot={slot} /> },
      { part: "content", node: (slot) => <parts.Content data-slot={slot} /> },
      { part: "footer", node: (slot) => <parts.Footer data-slot={slot} /> },
    ];

    it("names each part under the prefix, and composes an inherited slot token after its own", async () => {
      for (const { part, node } of slotted) {
        expect(attrsOf(await render(node()))["data-slot"]).toBe(`${prefix}-${part}`);
        expect(attrsOf(await render(node("kept")))["data-slot"]).toBe(`${prefix}-${part} kept`);
      }
    });

    it("derives the Title's id from the root it names, as the root's aria-labelledby does", async () => {
      const html = await render(<parts.Title for='x'>t</parts.Title>);

      expect(tagOf(html).startsWith("<h2 ")).toBe(true);
      expect(attrsOf(html)).toEqual({ "data-slot": `${prefix}-title`, id: "x-title" });
    });

    it("derives the Description's id from the root it describes, as the root's aria-describedby does", async () => {
      const html = await render(<parts.Description for='x'>m</parts.Description>);

      expect(tagOf(html).startsWith("<p ")).toBe(true);
      expect(attrsOf(html)).toEqual({ "data-slot": `${prefix}-description`, id: "x-description" });
    });

    it("opens the root as a modal from the Trigger through an invoker command", async () => {
      expect(attrsOf(await render(<parts.Trigger for='x'>Open</parts.Trigger>))).toEqual({
        type: "button",
        "data-slot": `${prefix}-trigger`,
        command: "show-modal",
        commandfor: "x",
      });
    });

    it("closes the root outright from the Close, and through the cancelable close request when asked", async () => {
      expect(attrsOf(await render(<parts.Close for='x'>Done</parts.Close>))).toEqual({
        type: "button",
        "data-slot": `${prefix}-close`,
        command: "close",
        commandfor: "x",
      });
      expect(
        attrsOf(
          await render(
            <parts.Close for='x' request>
              Done
            </parts.Close>,
          ),
        ).command,
      ).toBe("request-close");
    });

    it("forwards shape to the Trigger's and Close's box without leaving it on the button", async () => {
      for (const html of [await render(<parts.Trigger for='x' shape='icon' />), await render(<parts.Close for='x' shape='icon' />)]) {
        for (const token of ["w-control-sm", "px-0", "h-control-sm"]) expect(classesOf(html)).toContain(token);
        expect(classesOf(html)).not.toContain("px-3");
        expect(attrsOf(html)).not.toHaveProperty("shape");
      }
    });

    it("keeps the sm height under every shape it accepts, and refuses the square that would trade it away", async () => {
      for (const shape of ["default", "icon", "circle"] as const) {
        expect(classesOf(await render(<parts.Trigger for='x' shape={shape} />))).toContain("h-control-sm");
        expect(classesOf(await render(<parts.Close for='x' shape={shape} />))).toContain("h-control-sm");
      }
      // @ts-expect-error -- `square` resolves to `h-auto`, so the box would no longer hold the Floor
      void (<parts.Close for='x' shape='square' />);
    });

    it("dresses the Content in the class it was built with, and lets a caller's conflicting token evict one of it", async () => {
      expect(classesOf(await render(<parts.Content>c</parts.Content>))).toEqual(["px-6", "overflow-y-auto"]);
      expect(classesOf(await render(<parts.Content class='px-2'>c</parts.Content>))).toEqual(["overflow-y-auto", "px-2"]);
    });

    it("rules the Header and Footer off with the shared panel bands", async () => {
      expect(classesOf(await render(<parts.Header>h</parts.Header>))).toEqual(PANEL_HEADER.split(" "));
      expect(classesOf(await render(<parts.Footer>f</parts.Footer>))).toEqual(PANEL_FOOTER.split(" "));
    });
  });
}
