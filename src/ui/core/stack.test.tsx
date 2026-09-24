/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Stack } from "./stack";

const pile = (props: Parameters<typeof Stack>[0] = {}) => render(<Stack {...props} />);

describe("Stack", () => {
  it("renders the whole pile exactly, caller class merged last and both classes and text escaped", async () => {
    expect(
      await render(
        <Stack class='w-40' data-slot='pile' data-note='a&b'>
          {`R&D's`}
        </Stack>,
      ),
    ).toBe(
      '<div data-slot="stack pile" data-placement="bottom" class="grid place-items-center [&amp;&gt;*]:w-full [&amp;&gt;*]:[grid-area:1/1]' +
        " [&amp;&gt;*:nth-child(1)]:z-20 [&amp;&gt;*:nth-child(2)]:z-10 [&amp;&gt;*:nth-child(2)]:scale-95 [&amp;&gt;*:nth-child(2)]:opacity-90" +
        " [&amp;&gt;*:nth-child(3)]:z-0 [&amp;&gt;*:nth-child(3)]:scale-90 [&amp;&gt;*:nth-child(3)]:opacity-80" +
        ' [&amp;&gt;*:nth-child(2)]:translate-y-2 [&amp;&gt;*:nth-child(3)]:translate-y-4 w-40" data-note="a&amp;b">R&amp;D&#39;s</div>',
    );
  });

  it("layers every child into the one grid cell, so the pile is as tall as its tallest card", async () => {
    const html = await render(
      <Stack>
        <span>a</span>
        <span>b</span>
      </Stack>,
    );

    expect(classesOf(html).at(0)).toBe("grid");
    expect(classesOf(html).filter((token) => token.startsWith("[&amp;&gt;*]"))).toEqual(["[&amp;&gt;*]:w-full", "[&amp;&gt;*]:[grid-area:1/1]"]);
    expect(html).toEndWith("<span>a</span><span>b</span></div>");
  });

  it("names the direction it fans in, so a variant is readable without reading a class list", async () => {
    expect(attrsOf(await pile())).toEqual({ "data-slot": "stack", "data-placement": "bottom" });
    expect(attrsOf(await pile({ placement: "top" }))).toEqual({ "data-slot": "stack", "data-placement": "top" });
  });

  it("fans the layers upwards rather than adding a second offset to the downward one", async () => {
    expect(variantClasses(await pile({ placement: "top" }), await pile())).toEqual({
      added: ["[&amp;&gt;*:nth-child(2)]:-translate-y-2", "[&amp;&gt;*:nth-child(3)]:-translate-y-4"],
      dropped: ["[&amp;&gt;*:nth-child(2)]:translate-y-2", "[&amp;&gt;*:nth-child(3)]:translate-y-4"],
    });
  });

  it("fans towards the inline start and mirrors itself under rtl, where start is the other side", async () => {
    expect(variantClasses(await pile({ placement: "start" }), await pile())).toEqual({
      added: [
        "[&amp;&gt;*:nth-child(2)]:-translate-x-2",
        "[&amp;&gt;*:nth-child(3)]:-translate-x-4",
        "rtl:[&amp;&gt;*:nth-child(2)]:translate-x-2",
        "rtl:[&amp;&gt;*:nth-child(3)]:translate-x-4",
      ],
      dropped: ["[&amp;&gt;*:nth-child(2)]:translate-y-2", "[&amp;&gt;*:nth-child(3)]:translate-y-4"],
    });
  });

  it("fans towards the inline end and mirrors itself under rtl, where end is the other side", async () => {
    expect(variantClasses(await pile({ placement: "end" }), await pile())).toEqual({
      added: [
        "[&amp;&gt;*:nth-child(2)]:translate-x-2",
        "[&amp;&gt;*:nth-child(3)]:translate-x-4",
        "rtl:[&amp;&gt;*:nth-child(2)]:-translate-x-2",
        "rtl:[&amp;&gt;*:nth-child(3)]:-translate-x-4",
      ],
      dropped: ["[&amp;&gt;*:nth-child(2)]:translate-y-2", "[&amp;&gt;*:nth-child(3)]:translate-y-4"],
    });
  });

  it("lets a caller relabel data-placement for its own styling without moving the fan", async () => {
    const html = await pile({ "data-placement": "custom" });

    expect(attrOf(html, "data-placement")).toBe("custom");
    expect(variantClasses(html, await pile())).toEqual({ added: [], dropped: [] });
  });
});
