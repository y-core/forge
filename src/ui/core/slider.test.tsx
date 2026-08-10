import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Slider, sanitizeRangeValue } from "./slider";

describe("Slider", () => {
  it("renders a bare range input by default", async () => {
    expect(await render(<Slider min={0} max={10} step={1} value={4} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="10" step="1" value="4">',
    );
  });

  it("wraps the input with a seeded output when output is set", async () => {
    expect(await render(<Slider min={0} max={10} value={4} output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="10" value="4"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">4</output></div>',
    );
  });

  it("spreads delegation attributes onto the input", async () => {
    expect(await render(<Slider data-on-input='setOpacity' data-setting='opacity' data-ref='opacity-slider' />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" data-on-input="setOpacity" data-setting="opacity" data-ref="opacity-slider">',
    );
  });

  it("passes the disabled attribute through", async () => {
    expect(await render(<Slider disabled />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" disabled>',
    );
    expect(await render(<Slider />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50">',
    );
  });

  it("merges a custom class with the base classes", async () => {
    expect(await render(<Slider class='extra-class' />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50 extra-class">',
    );
  });

  it("wires field id and name from the descriptor", async () => {
    expect(await render(<Slider field={{ name: "opacity" }} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" id="field-opacity" name="opacity">',
    );
  });

  it("adds aria-invalid and aria-describedby when the field is invalid", async () => {
    expect(await render(<Slider field={{ name: "opacity", invalid: true }} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" id="field-opacity" name="opacity" aria-describedby="field-opacity-error" aria-invalid="true">',
    );
  });

  it("horizontal orientation (default) uses the standard horizontal base classes", async () => {
    expect(await render(<Slider min={0} max={10} value={5} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="10" value="5">',
    );
  });

  // The vertical override carries `h-22 w-5`, which displaces the base's `h-2 w-full` outright —
  // a vertical slider is 22 tall and 5 wide. Which of the two applied used to be decided by `.h-2`
  // vs `.h-22` sheet order; `cn` now settles it at composition time.
  it("vertical orientation adds writing-mode and direction classes to the slider", async () => {
    expect(await render(<Slider min={0} max={10} value={5} orientation='vertical' />)).toBe(
      '<input data-slot="slider" type="range" class="cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50 [writing-mode:vertical-lr] [direction:rtl] h-22 w-5" min="0" max="10" value="5">',
    );
  });

  it("vertical orientation with output wraps in a flex-col container", async () => {
    expect(await render(<Slider min={0} max={10} value={5} orientation='vertical' output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 flex-col items-center"><input data-slot="slider" type="range" class="cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50 [writing-mode:vertical-lr] [direction:rtl] h-22 w-5" min="0" max="10" value="5"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">5</output></div>',
    );
  });

  // The reported defect: the browser clamps the thumb to `max`, and with no client controller the
  // readout is the only thing forge can bring into agreement with it. The emitted `value` attribute
  // is deliberately left alone — forge reports the browser's reading, it does not rewrite the input.
  it("clamps the output readout to max while leaving the value attribute intact", async () => {
    expect(await render(<Slider min={0} max={100} value={150} output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="100" value="150"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">100</output></div>',
    );
  });

  it("renders the range default in the readout for an array value the browser cannot parse", async () => {
    expect(await render(<Slider value={["a", "b"]} output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" value="a,b"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">50</output></div>',
    );
  });

  it("leaves an out-of-range value untouched when no output is requested", async () => {
    expect(await render(<Slider min={0} max={100} value={150} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="100" value="150">',
    );
  });

  it("composes field wiring with a sanitized readout", async () => {
    expect(await render(<Slider field={{ name: "opacity" }} min={0} max={100} value={150} output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="100" value="150" id="field-opacity" name="opacity"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">100</output></div>',
    );
  });
});

type RangeAttrs = Parameters<typeof sanitizeRangeValue>[0];
type OracleRow = { input: RangeAttrs; expected: string; why: string };

/** Renders the attribute set into an `it` title without pulling in a serializer. */
function label(input: RangeAttrs): string {
  const parts = (["min", "max", "step", "value"] as const)
    .filter((key) => input[key] !== undefined)
    .map((key) => `${key}=${JSON.stringify(input[key])}`);
  return parts.length > 0 ? parts.join(" ") : "no attributes";
}

function runOracle(cases: OracleRow[]): void {
  for (const { input, expected, why } of cases) {
    it(`${label(input)} → "${expected}" — ${why}`, () => {
      expect(sanitizeRangeValue(input)).toBe(expected);
    });
  }
}

// Every row below was probed from a real Chromium and is ground truth for what the browser's own
// value-sanitization algorithm settles on. A row that fails is a defect in the implementation, not
// an expectation to be updated.
describe("sanitizeRangeValue", () => {
  describe("clamps to the declared range", () => {
    runOracle([
      { input: { min: 0, max: 100, value: 150 }, expected: "100", why: "above max clamps down to max" },
      { input: { min: 0, max: 100, value: -10 }, expected: "0", why: "below min clamps up to min" },
    ]);
  });

  describe("falls back to the range midpoint for a value the browser rejects", () => {
    runOracle([
      { input: { min: 0, max: 100, value: "abc" }, expected: "50", why: "non-numeric text is not a valid floating-point number" },
      { input: { min: 0, max: 100, value: "" }, expected: "50", why: "the empty string parses as nothing, not as zero" },
      { input: { min: 0, max: 100, value: "Infinity" }, expected: "50", why: "Infinity is not a valid floating-point number" },
      { input: { min: 0, max: 100, value: "1e999" }, expected: "50", why: "an overflowing exponent yields a non-finite number" },
      { input: { min: 0, max: 100, value: "0x10" }, expected: "50", why: "hexadecimal notation is not accepted" },
      { input: { min: 0, max: 100, value: "10." }, expected: "50", why: "a bare trailing dot is invalid" },
      { input: { min: 0, max: 100, value: "+70" }, expected: "50", why: "a leading plus sign is invalid" },
      { input: { min: 0, max: 100, value: "  70  " }, expected: "50", why: "surrounding whitespace is not stripped" },
      { input: { min: 0, max: 100, value: "70 " }, expected: "50", why: "one trailing space is enough to invalidate" },
      { input: { min: 10, max: 20 }, expected: "15", why: "an absent value takes the midpoint of the declared range" },
      { input: { min: -10, max: -5 }, expected: "-7", why: "a negative midpoint of -7.5 snaps to -7, ties toward +Infinity" },
      { input: {}, expected: "50", why: "with no attributes at all the range is 0–100 and the value its midpoint" },
    ]);
  });

  describe("accepts valid but unusual value spellings", () => {
    runOracle([
      { input: { min: 0, max: 100, value: ".5" }, expected: "1", why: "a leading dot is valid where a trailing dot is not" },
      { input: { min: 0, max: 100, value: "1e2" }, expected: "100", why: "exponent notation parses to 100" },
      { input: { min: 0, max: 100, value: "50.5" }, expected: "51", why: "a fractional value snaps to the default step of 1" },
    ]);
  });

  describe("snaps to the nearest step, breaking ties toward +Infinity", () => {
    runOracle([
      { input: { min: 0, max: 10, step: 10, value: 4 }, expected: "0", why: "below the halfway point rounds down" },
      { input: { min: 0, max: 10, step: 10, value: 5 }, expected: "10", why: "an exact tie rounds up, not to even" },
      { input: { min: 0, max: 100, step: 10, value: 35 }, expected: "40", why: "a tie at 3.5 steps rounds up" },
    ]);
  });

  describe("takes the next lower step when snapping would overflow max", () => {
    runOracle([
      { input: { min: 0, max: 10, step: 4, value: 10 }, expected: "8", why: "12 exceeds max, so the largest in-range step wins" },
      { input: { min: 0, max: 10, step: 3, value: 9.5 }, expected: "9", why: "12 exceeds max, so 9 is the highest reachable step" },
    ]);
  });

  describe("anchors the step base at min", () => {
    runOracle([
      { input: { min: -50, max: 50, step: 7, value: 0 }, expected: "-1", why: "steps are counted from -50, not from zero" },
      { input: { min: 0.05, max: 1, step: 0.1, value: 0.5 }, expected: "0.55", why: "a fractional base offsets every reachable step" },
      { input: { min: 0.1, max: 1, step: 0.2, value: 0.55 }, expected: "0.5", why: "2.25 steps from the base rounds down to 2" },
    ]);
  });

  // The naive implementation anchors at zero when `min` is absent and silently snaps the value away
  // from itself. Each fallback row is paired with its `min: 0` form so the two cannot be conflated.
  describe("falls back to the value attribute as the step base when min is absent", () => {
    runOracle([
      { input: { max: 100, step: 10, value: 35 }, expected: "35", why: "with no min the value is aligned to itself" },
      { input: { min: 0, max: 100, step: 10, value: 35 }, expected: "40", why: "an explicit min of 0 moves the base and snaps the tie up" },
      { input: { max: 100, step: 10, value: 36 }, expected: "36", why: "the same holds for a value that is not a tie" },
      { input: { min: 0, max: 100, step: 10, value: 36 }, expected: "40", why: "an explicit min of 0 snaps 36 to the nearest step" },
    ]);
  });

  describe("disables snapping for step=any, matched case-insensitively", () => {
    runOracle([
      { input: { min: 0, max: 1, step: "any", value: 0.37 }, expected: "0.37", why: "any leaves the value exactly where it was" },
      { input: { min: 0, max: 100, step: "ANY", value: 37.5 }, expected: "37.5", why: "the keyword match is ASCII case-insensitive" },
    ]);
  });

  describe("falls back to a step of 1 for an invalid step, rather than disabling snapping", () => {
    runOracle([
      { input: { min: 0, max: 100, step: "0", value: "37.5" }, expected: "38", why: "a zero step is non-positive and becomes 1" },
      { input: { min: 0, max: 100, step: "-5", value: "37.5" }, expected: "38", why: "a negative step is non-positive and becomes 1" },
      { input: { min: 0, max: 100, step: "abc", value: "37.5" }, expected: "38", why: "an unparseable step becomes 1" },
      { input: { min: 0, max: 100, step: "0", value: "37" }, expected: "37", why: "an already-aligned value survives the fallback step" },
      { input: { min: 0, max: 100, step: "-5", value: "37" }, expected: "37", why: "an already-aligned value survives the fallback step" },
      { input: { min: 0, max: 100, step: "abc", value: "37" }, expected: "37", why: "an already-aligned value survives the fallback step" },
    ]);
  });

  describe("falls back to the default 0–100 range for an invalid min or max", () => {
    runOracle([{ input: { min: "abc", max: "xyz", value: 37 }, expected: "37", why: "both bounds default and the value stays in range" }]);
  });

  describe("collapses the range to min when max is below it", () => {
    runOracle([
      { input: { min: 100, max: 0, value: 50 }, expected: "100", why: "the range is the single point 100" },
      { input: { min: 5, max: 1, step: 2, value: 9 }, expected: "5", why: "the collapsed point wins over the step grid" },
    ]);
  });

  // Asserted as strings on purpose: a numeric assertion would pass on 5.1000000000000005 and defeat
  // the whole point of the scrub.
  describe("emits fractional results without binary-float noise", () => {
    runOracle([
      {
        input: { min: 0, max: 1, step: 0.1, value: 0.35 },
        expected: "0.4",
        why: "0.35/0.1 is 3.4999999999999996 in binary, but the tie rounds up",
      },
      { input: { min: 0, max: 1, step: 0.1, value: 0.3 }, expected: "0.3", why: "an aligned fractional value round-trips unchanged" },
      { input: { min: 0, max: 1, step: 0.1, value: 0.7000001 }, expected: "0.7", why: "a near-aligned value snaps back onto the grid" },
      { input: { min: 0, max: 10, step: 0.3, value: 5 }, expected: "5.1", why: "17*0.3 is 5.1000000000000005 and must read 5.1" },
      { input: { min: 0, max: 10, step: 0.7, value: 3.33 }, expected: "3.5", why: "5*0.7 is 3.4999999999999996 and must read 3.5" },
      {
        input: { min: 0, max: 5, step: "1e-1", value: 1.25 },
        expected: "1.3",
        why: "an exponent-spelled step parses to 0.1 and the tie rounds up",
      },
    ]);
  });
});
