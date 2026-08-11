import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { NumberField } from "./number-field";

/**
 * `core/NumberField`'s SSR markup, pinned exactly.
 *
 * Stepping, clamping and `min`/`max` enforcement belong to `<input type="number">`, and
 * `number-field.browser.ts` drives the controller that calls into it — so nothing here asserts
 * arithmetic. What is pinned is what forge decides: the input's `type`, the scope the controller
 * resumes on, the two buttons' `aria-label`s and their default glyphs, and that every one of those
 * survives a caller's spread.
 */

const INPUT_BASE =
  "w-20 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_BASE =
  "inline-flex size-8 items-center justify-center rounded-md border border-input bg-background " +
  "text-foreground cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

describe("NumberField", () => {
  it("renders the root row with the scope the controller resumes on", async () => {
    expect(await render(<NumberField />)).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1"></div>',
    );
  });

  it("merges a caller class onto the root base", async () => {
    expect(await render(<NumberField class='w-full' />)).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1 w-full"></div>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<NumberField data-slot='quantity' />)).toBe(
      '<div data-slot="number-field quantity" data-scope="number-field" class="inline-flex items-center gap-1"></div>',
    );
  });

  it("escapes arbitrary data-* and aria-* values spread onto the root", async () => {
    expect(await render(<NumberField data-note={`R&D's "count" <n>`} aria-label={`R&D's count`} />)).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1" ' +
        'data-note="R&amp;D&#39;s &quot;count&quot; &lt;n&gt;" aria-label="R&amp;D&#39;s count"></div>',
    );
  });

  // `aria-readonly` is not a supported attribute of `role="button"`, so a stepper carrying one is
  // invalid ARIA rather than merely redundant — assistive technology is entitled to ignore it or to
  // announce something the button does not mean. The temptation is real: the input beside them is
  // genuinely read-only here, and propagating that state onto its two steppers reads as
  // thorough. It is the readonly input, not the buttons, that carries the state.
  //
  // Asserted as exact markup rather than `.not.toContain("aria-readonly")`: TESTING.md §3b bans the
  // substring form, and §3d rules out a negative that would pass just as well if the buttons were
  // deleted outright.
  it("keeps aria-readonly off the steppers even when the input beside them is readonly", async () => {
    expect(
      await render(
        <NumberField>
          <NumberField.Decrement />
          <NumberField.Input name='count' value='1' readonly />
          <NumberField.Increment />
        </NumberField>,
      ),
    ).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1">' +
        `<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="${BUTTON_BASE}">−</button>` +
        `<input type="number" data-slot="number-field-input" class="${INPUT_BASE}" name="count" value="1" readonly>` +
        `<button type="button" data-slot="number-field-increment" aria-label="Increment" class="${BUTTON_BASE}">+</button>` +
        "</div>",
    );
  });

  it("renders the whole compound in one tree", async () => {
    expect(
      await render(
        <NumberField>
          <NumberField.Decrement />
          <NumberField.Input name='count' value='1' min='0' max='10' />
          <NumberField.Increment />
        </NumberField>,
      ),
    ).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1">' +
        `<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="${BUTTON_BASE}">−</button>` +
        `<input type="number" data-slot="number-field-input" class="${INPUT_BASE}" name="count" value="1" min="0" max="10">` +
        `<button type="button" data-slot="number-field-increment" aria-label="Increment" class="${BUTTON_BASE}">+</button>` +
        "</div>",
    );
  });
});

describe("NumberField.Input", () => {
  it("renders a native number input and nothing more", async () => {
    expect(await render(<NumberField.Input />)).toBe(`<input type="number" data-slot="number-field-input" class="${INPUT_BASE}">`);
  });

  it("passes the platform's own range attributes straight through", async () => {
    expect(await render(<NumberField.Input name='count' value='3' min='0' max='10' step='2' required />)).toBe(
      `<input type="number" data-slot="number-field-input" class="${INPUT_BASE}" name="count" value="3" min="0" max="10" step="2" required>`,
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(await render(<NumberField.Input class='w-32' data-slot='quantity-input' />)).toBe(
      '<input type="number" data-slot="number-field-input quantity-input" class="rounded-md border border-input bg-background ' +
        "px-2 py-1 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        'disabled:cursor-not-allowed disabled:opacity-50 w-32">',
    );
  });
});

describe("NumberField.Decrement", () => {
  it("defaults to a minus-sign glyph behind an explicit label", async () => {
    expect(await render(<NumberField.Decrement />)).toBe(
      `<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="${BUTTON_BASE}">−</button>`,
    );
  });

  it("takes caller children in place of the glyph, and passes disabled through", async () => {
    expect(await render(<NumberField.Decrement disabled>Less</NumberField.Decrement>)).toBe(
      `<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="${BUTTON_BASE}" disabled>Less</button>`,
    );
  });

  it("lets a caller replace the default label in place, and override the conflicting size utility", async () => {
    // The caller's `aria-label` overwrites the component's value without moving: the key already
    // exists in the prop bag when the rest spread lands on it.
    expect(await render(<NumberField.Decrement aria-label={`Fewer R&D's`} class='size-6' data-slot='quantity-down' />)).toBe(
      '<button type="button" data-slot="number-field-decrement quantity-down" aria-label="Fewer R&amp;D&#39;s" ' +
        'class="inline-flex items-center justify-center rounded-md border border-input bg-background ' +
        "text-foreground cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring " +
        'disabled:pointer-events-none disabled:opacity-50 size-6">−</button>',
    );
  });
});

describe("NumberField.Increment", () => {
  it("defaults to a plus glyph behind an explicit label", async () => {
    expect(await render(<NumberField.Increment />)).toBe(
      `<button type="button" data-slot="number-field-increment" aria-label="Increment" class="${BUTTON_BASE}">+</button>`,
    );
  });

  it("takes caller children in place of the glyph and escapes them", async () => {
    expect(await render(<NumberField.Increment>{`R&D's <up>`}</NumberField.Increment>)).toBe(
      `<button type="button" data-slot="number-field-increment" aria-label="Increment" class="${BUTTON_BASE}">` +
        "R&amp;D&#39;s &lt;up&gt;</button>",
    );
  });
});
