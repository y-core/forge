import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Meter, meterState } from "./meter";

const contentOf = (html: string): string => html.slice(tagOf(html).length, html.lastIndexOf("<"));

describe("Meter", () => {
  it("renders the whole wrapper exactly, every forwarded value escaped", async () => {
    expect(await render(<Meter data-note={`R&D's "top" <5%`} aria-label={`R&D's quota`} />)).toBe(
      '<div data-slot="meter" class="flex w-full max-w-sm flex-col gap-1" data-note="R&amp;D&#39;s &quot;top&quot; &lt;5%" aria-label="R&amp;D&#39;s quota"></div>',
    );
  });

  it("names itself on the slot token a stylesheet and a controller both key on", async () => {
    expect(attrsOf(await render(<Meter />))).toEqual({ "data-slot": "meter" });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Meter class='my-meter' />)).at(-1)).toBe("my-meter");
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Meter data-slot='quota-meter' />), "data-slot")).toBe("meter quota-meter");
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(attrOf(await render(<Meter data-slot='' />), "data-slot")).toBe("meter");
  });

  it("nests the label, the track and the readout inside the root, in the order they were given", async () => {
    const html = await render(
      <Meter>
        <Meter.Label for='disk'>Disk usage</Meter.Label>
        <Meter.Track id='disk' value={0.72} low={0.3} high={0.8} optimum={0.2} />
        <Meter.Value>72%</Meter.Value>
      </Meter>,
    );

    expect([...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1])).toEqual(["meter", "meter-label", "meter-track", "meter-value"]);
  });
});

describe("Meter.Label", () => {
  it("is a real label bound to the measurement it describes", async () => {
    const html = await render(<Meter.Label for='disk'>Disk usage</Meter.Label>);

    expect(attrsOf(html)).toEqual({ "data-slot": "meter-label", for: "disk" });
    expect(contentOf(html)).toBe("Disk usage");
  });

  it("appends a caller class last and an inherited slot token after its own", async () => {
    const html = await render(
      <Meter.Label for='disk' class='uppercase' data-slot='field-label'>
        Disk usage
      </Meter.Label>,
    );

    expect(classesOf(html).at(-1)).toBe("uppercase");
    expect(attrOf(html, "data-slot")).toBe("meter-label field-label");
  });
});

describe("Meter.Track", () => {
  it("is the platform's own meter element, carrying the value and the band computed from it", async () => {
    const html = await render(<Meter.Track value={0.5} />);

    expect(tagOf(html).startsWith("<meter ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "meter-track", "data-state": "optimum", value: "0.5" });
  });

  it("passes the platform's own threshold attributes straight through", async () => {
    expect(attrsOf(await render(<Meter.Track value={0.72} min={0} max={1} low={0.3} high={0.8} optimum={0.2} />))).toEqual({
      "data-slot": "meter-track",
      "data-state": "suboptimum",
      value: "0.72",
      min: "0",
      max: "1",
      low: "0.3",
      high: "0.8",
      optimum: "0.2",
    });
  });

  it("lets a caller height evict its own rather than stacking a second one", async () => {
    const html = await render(<Meter.Track value={0.5} class='h-3' data-slot='quota-track' />);

    expect(variantClasses(html, await render(<Meter.Track value={0.5} />))).toEqual({ added: ["h-3"], dropped: ["h-2"] });
    expect(attrOf(html, "data-slot")).toBe("meter-track quota-track");
  });
});

describe("Meter.Value", () => {
  it("is a readout span carrying the text it was given", async () => {
    const html = await render(<Meter.Value>72%</Meter.Value>);

    expect(attrsOf(html)).toEqual({ "data-slot": "meter-value" });
    expect(contentOf(html)).toBe("72%");
  });

  it("escapes interpolated children", async () => {
    expect(contentOf(await render(<Meter.Value>{`>72% of R&D's quota`}</Meter.Value>))).toBe("&gt;72% of R&amp;D&#39;s quota");
  });
});

describe("meterState — HTML's own banding, which decides the fill colour", () => {
  it("reads the optimum band from where the optimum point sits, not from the value alone", () => {
    // Optimum below `low`: the low band is the good one, the high band the worst.
    expect(meterState({ value: 0.1, low: 0.3, high: 0.8, optimum: 0.2 })).toBe("optimum");
    expect(meterState({ value: 0.5, low: 0.3, high: 0.8, optimum: 0.2 })).toBe("suboptimum");
    expect(meterState({ value: 0.9, low: 0.3, high: 0.8, optimum: 0.2 })).toBe("poor");
  });

  // HTML's `GetGaugeRegion` puts `value <= low` in the low region and `value >= high` in the high
  // one, so strict comparisons would read both boundaries one band too optimistic.
  it("puts a value sitting exactly on a threshold in that threshold's own band", () => {
    expect(meterState({ value: 0.3, low: 0.3, high: 0.8, optimum: 0.2 })).toBe("optimum");
    expect(meterState({ value: 0.8, low: 0.3, high: 0.8, optimum: 0.2 })).toBe("poor");
    expect(meterState({ value: 0.3, low: 0.3, high: 0.8, optimum: 0.95 })).toBe("poor");
    expect(meterState({ value: 0.8, low: 0.3, high: 0.8, optimum: 0.95 })).toBe("optimum");
  });

  it("mirrors the bands when the optimum point is above `high`", () => {
    expect(meterState({ value: 0.9, low: 0.3, high: 0.8, optimum: 0.95 })).toBe("optimum");
    expect(meterState({ value: 0.5, low: 0.3, high: 0.8, optimum: 0.95 })).toBe("suboptimum");
    expect(meterState({ value: 0.1, low: 0.3, high: 0.8, optimum: 0.95 })).toBe("poor");
  });

  it("makes both outer bands merely suboptimum when the optimum point is between them", () => {
    expect(meterState({ value: 0.5, low: 0.3, high: 0.8, optimum: 0.5 })).toBe("optimum");
    expect(meterState({ value: 0.1, low: 0.3, high: 0.8, optimum: 0.5 })).toBe("suboptimum");
    expect(meterState({ value: 0.9, low: 0.3, high: 0.8, optimum: 0.5 })).toBe("suboptimum");
  });

  it("applies HTML's defaults and clamps: no thresholds is one band, and every band is optimum", () => {
    expect(meterState({ value: 0.5 })).toBe("optimum");
    expect(meterState({ value: 72, min: 0, max: 100 })).toBe("optimum");
  });

  it("clamps a high below low, a value outside the range, and a value that is not a number at all", () => {
    expect(meterState({ value: 200, min: 0, max: 100, low: 30, high: 10, optimum: 0 })).toBe("poor");
    expect(meterState({ value: Number.NaN, min: 0, max: 100, low: 30, high: 90, optimum: 100 })).toBe("poor");
  });
});
