/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Indicator } from "./indicator";
import { attrsOf, classesOf, variantClasses } from "./test-support";

const pip = (props: Parameters<typeof Indicator.Item>[0] = {}) => render(<Indicator.Item {...props}>9</Indicator.Item>);

describe("Indicator", () => {
  it("renders the whole wrapper and its corner item exactly, caller class merged last and text escaped", async () => {
    expect(
      await render(
        <Indicator class='block' id='i1' data-note='a&b'>
          <span>x</span>
          <Indicator.Item>{`R&D's`}</Indicator.Item>
        </Indicator>,
      ),
    ).toBe(
      '<div data-slot="indicator" class="relative block" id="i1" data-note="a&amp;b"><span>x</span>' +
        '<span data-slot="indicator-item" data-placement="top-end" class="absolute z-10 end-0 top-0 translate-x-1/2 -translate-y-1/2">R&amp;D&#39;s</span></div>',
    );
  });

  it("gives the wrapper the positioning context the absolutely placed item resolves against", async () => {
    const html = await render(
      <Indicator>
        <span>x</span>
        <Indicator.Item>9</Indicator.Item>
      </Indicator>,
    );

    expect(classesOf(html).at(0)).toBe("relative");
    expect(classesOf(html, 'data-slot="indicator-item"').at(0)).toBe("absolute");
  });

  it("names the corner it was placed on, so a variant is readable without reading a class list", async () => {
    expect(attrsOf(await pip())).toEqual({ "data-slot": "indicator-item", "data-placement": "top-end" });
    expect(attrsOf(await pip({ placement: "bottom-start" }))).toEqual({ "data-slot": "indicator-item", "data-placement": "bottom-start" });
  });

  it("moves an item to the opposite inline edge rather than pinning it to both", async () => {
    expect(variantClasses(await pip({ placement: "top-start" }), await pip())).toEqual({
      added: ["start-0", "-translate-x-1/2"],
      dropped: ["end-0", "translate-x-1/2"],
    });
  });

  it("straddles the bottom edge instead of the top when placed below", async () => {
    expect(variantClasses(await pip({ placement: "bottom-end" }), await pip())).toEqual({
      added: ["bottom-0", "translate-y-1/2"],
      dropped: ["top-0", "-translate-y-1/2"],
    });
  });

  it("swaps both axes at once for the far corner, leaving neither edge of the default behind", async () => {
    expect(variantClasses(await pip({ placement: "bottom-start" }), await pip())).toEqual({
      added: ["start-0", "bottom-0", "-translate-x-1/2", "translate-y-1/2"],
      dropped: ["end-0", "top-0", "translate-x-1/2", "-translate-y-1/2"],
    });
  });

  it("lets a caller class win on an item and keeps its own slot token ahead of an inherited one", async () => {
    const html = await pip({ class: "z-20", "data-slot": "inherited", "data-note": "a&b" });

    expect(classesOf(html).at(-1)).toBe("z-20");
    expect(attrsOf(html)).toEqual({ "data-slot": "indicator-item inherited", "data-placement": "top-end", "data-note": "a&amp;b" });
  });
});
