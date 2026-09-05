/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Toggle } from "./toggle";

const TOGGLE_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-field px-2.5 font-medium border-field " +
  "border-input bg-transparent text-foreground focus-ring hover:bg-accent hover:text-accent-foreground " +
  "state-busy state-disabled state-invalid has-[:checked]:bg-primary has-[:checked]:text-primary-foreground " +
  "has-[:checked]:hover:bg-primary cursor-pointer h-control-md text-sm";

const TOGGLE_OPEN = `<label data-slot="toggle" data-size="md" class="${TOGGLE_CLASS}">`;

describe("controls/Toggle", () => {
  it("stamps data-field on the checkbox, which is what bindControls reads", async () => {
    expect(await render(<Toggle bind='bold' name='bold' />)).toBe(
      `${TOGGLE_OPEN}<input data-slot="toggle-input" type="checkbox" class="sr-only" name="bold" data-field="bold"></label>`,
    );
  });

  it("carries the server-rendered pressed state through as checkedness", async () => {
    expect(await render(<Toggle bind='bold' pressed />)).toBe(
      `${TOGGLE_OPEN}<input data-slot="toggle-input" type="checkbox" class="sr-only" checked data-field="bold"></label>`,
    );
  });
});
