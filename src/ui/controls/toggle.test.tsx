/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Toggle } from "./toggle";

describe("controls/Toggle", () => {
  it("stamps data-field on the checkbox, which is what bindControls reads", async () => {
    const out = await render(<Toggle bind='bold' name='bold' />);

    expect(out).toContain('type="checkbox"');
    expect(out).toContain('data-field="bold"');
  });

  it("carries the server-rendered pressed state through as checkedness", async () => {
    expect(await render(<Toggle bind='bold' pressed />)).toContain(" checked");
  });
});
