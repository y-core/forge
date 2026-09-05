import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Meter, meterState } from "./meter";

const ROOT_BASE = "flex w-full max-w-sm flex-col gap-1";

describe("Meter", () => {
  it("renders the root wrapper with its slot token and base classes", async () => {
    expect(await render(<Meter />)).toBe(`<div data-slot="meter" class="${ROOT_BASE}"></div>`);
  });

  it("merges a caller class onto the root base", async () => {
    expect(await render(<Meter class='my-meter' />)).toBe(`<div data-slot="meter" class="${ROOT_BASE} my-meter"></div>`);
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<Meter data-slot='quota-meter' />)).toBe(`<div data-slot="meter quota-meter" class="${ROOT_BASE}"></div>`);
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Meter data-slot='' />)).toBe(`<div data-slot="meter" class="${ROOT_BASE}"></div>`);
  });

  it("escapes arbitrary data-* and aria-* values spread onto the root", async () => {
    expect(await render(<Meter data-note={`R&D's "top" <5%`} aria-label={`R&D's quota`} />)).toBe(
      `<div data-slot="meter" class="${ROOT_BASE}" data-note="R&amp;D&#39;s &quot;top&quot; &lt;5%" aria-label="R&amp;D&#39;s quota"></div>`,
    );
  });

  it("renders the whole compound in one tree", async () => {
    expect(
      await render(
        <Meter>
          <Meter.Label for='disk'>Disk usage</Meter.Label>
          <Meter.Track id='disk' value={0.72} low={0.3} high={0.8} optimum={0.2} />
          <Meter.Value>72%</Meter.Value>
        </Meter>,
      ),
    ).toBe(
      `<div data-slot="meter" class="${ROOT_BASE}">` +
        '<label data-slot="meter-label" for="disk" class="text-sm font-medium text-foreground">Disk usage</label>' +
        '<meter data-slot="meter-track" data-state="suboptimum" class="h-2 w-full rounded-selector bg-border" id="disk" value="0.72" low="0.3" high="0.8" optimum="0.2"></meter>' +
        '<span data-slot="meter-value" class="text-sm text-muted-foreground tabular-nums">72%</span>' +
        "</div>",
    );
  });
});

describe("Meter.Label", () => {
  it("renders a real label bound to the measurement it describes", async () => {
    expect(await render(<Meter.Label for='disk'>Disk usage</Meter.Label>)).toBe(
      '<label data-slot="meter-label" for="disk" class="text-sm font-medium text-foreground">Disk usage</label>',
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(
      await render(
        <Meter.Label for='disk' class='uppercase' data-slot='field-label'>
          Disk usage
        </Meter.Label>,
      ),
    ).toBe('<label data-slot="meter-label field-label" for="disk" class="text-sm font-medium text-foreground uppercase">Disk usage</label>');
  });
});

describe("Meter.Track", () => {
  it("renders a native meter carrying the value", async () => {
    expect(await render(<Meter.Track value={0.5} />)).toBe(
      '<meter data-slot="meter-track" data-state="optimum" class="h-2 w-full rounded-selector bg-border" value="0.5"></meter>',
    );
  });

  it("passes the platform's own threshold attributes straight through", async () => {
    expect(await render(<Meter.Track value={0.72} min={0} max={1} low={0.3} high={0.8} optimum={0.2} />)).toBe(
      '<meter data-slot="meter-track" data-state="suboptimum" class="h-2 w-full rounded-selector bg-border" value="0.72" min="0" max="1" low="0.3" high="0.8" optimum="0.2"></meter>',
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(await render(<Meter.Track value={0.5} class='h-3' data-slot='quota-track' />)).toBe(
      '<meter data-slot="meter-track quota-track" data-state="optimum" class="w-full rounded-selector bg-border h-3" value="0.5"></meter>',
    );
  });
});

describe("Meter.Value", () => {
  it("renders the readout span with its base classes", async () => {
    expect(await render(<Meter.Value>72%</Meter.Value>)).toBe(
      '<span data-slot="meter-value" class="text-sm text-muted-foreground tabular-nums">72%</span>',
    );
  });

  it("escapes interpolated children", async () => {
    expect(await render(<Meter.Value>{`>72% of R&D's quota`}</Meter.Value>)).toBe(
      '<span data-slot="meter-value" class="text-sm text-muted-foreground tabular-nums">&gt;72% of R&amp;D&#39;s quota</span>',
    );
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
  // one, so a value sitting exactly on a threshold belongs to that threshold's band, not between the
  // two. Strict comparisons put both boundaries in "medium" and read one band too optimistic.
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
