import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Meter } from "./meter";

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
        '<meter data-slot="meter-track" class="h-2 w-full" id="disk" value="0.72" low="0.3" high="0.8" optimum="0.2"></meter>' +
        '<span data-slot="meter-value" class="text-sm tabular-nums text-muted-foreground">72%</span>' +
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
    expect(await render(<Meter.Track value={0.5} />)).toBe('<meter data-slot="meter-track" class="h-2 w-full" value="0.5"></meter>');
  });

  it("passes the platform's own threshold attributes straight through", async () => {
    expect(await render(<Meter.Track value={0.72} min={0} max={1} low={0.3} high={0.8} optimum={0.2} />)).toBe(
      '<meter data-slot="meter-track" class="h-2 w-full" value="0.72" min="0" max="1" low="0.3" high="0.8" optimum="0.2"></meter>',
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(await render(<Meter.Track value={0.5} class='h-3' data-slot='quota-track' />)).toBe(
      '<meter data-slot="meter-track quota-track" class="w-full h-3" value="0.5"></meter>',
    );
  });
});

describe("Meter.Value", () => {
  it("renders the readout span with its base classes", async () => {
    expect(await render(<Meter.Value>72%</Meter.Value>)).toBe(
      '<span data-slot="meter-value" class="text-sm tabular-nums text-muted-foreground">72%</span>',
    );
  });

  it("escapes interpolated children", async () => {
    expect(await render(<Meter.Value>{`>72% of R&D's quota`}</Meter.Value>)).toBe(
      '<span data-slot="meter-value" class="text-sm tabular-nums text-muted-foreground">&gt;72% of R&amp;D&#39;s quota</span>',
    );
  });
});
