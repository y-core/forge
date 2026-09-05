/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { NumberField } from "./number-field";

const STEPPER_CLASS =
  "inline-flex size-8 items-center justify-center rounded-field border border-input bg-background " +
  "cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled";

const DECREMENT = `<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="${STEPPER_CLASS}">−</button>`;

const INCREMENT = `<button type="button" data-slot="number-field-increment" aria-label="Increment" class="${STEPPER_CLASS}">+</button>`;

const INPUT_CLASS = "state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm";

describe("controls/NumberField", () => {
  it("binds only the input, since the steppers drive it rather than the signal", async () => {
    expect(
      await render(
        <NumberField>
          <NumberField.Decrement />
          <NumberField.Input bind='count' value={3} />
          <NumberField.Increment />
        </NumberField>,
      ),
    ).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1">' +
        DECREMENT +
        `<input type="number" data-slot="number-field-input" data-size="md" class="${INPUT_CLASS}" value="3" data-field="count">` +
        INCREMENT +
        "</div>",
    );
  });

  it("re-exports the steppers unchanged, so the compound still composes", async () => {
    expect(await render(<NumberField.Increment />)).toBe(INCREMENT);
  });
});
