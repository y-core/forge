import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Switch } from "./switch";

describe("Switch", () => {
  it("renders a label wrapper with a checkbox input in switch role", async () => {
    const out = await render(<Switch />);
    expect(out).toContain('data-slot="switch"');
    expect(out).toContain('data-slot="switch-input"');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('role="switch"');
  });

  it("renders the decorative track and thumb", async () => {
    const out = await render(<Switch />);
    expect(out).toContain('data-slot="switch-track"');
    expect(out).toContain('data-slot="switch-thumb"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("reflects the checked attribute when set", async () => {
    const withChecked = await render(<Switch checked />);
    const withoutChecked = await render(<Switch />);
    expect(withChecked).toMatch(/\bchecked(?!:)/);
    expect(withoutChecked).not.toMatch(/\bchecked(?!:)/);
  });

  it("spreads delegation attributes onto the input", async () => {
    const out = await render(<Switch data-on-change='toggle' data-setting='grid' data-ref='grid-switch' />);
    expect(out).toContain('data-on-change="toggle"');
    expect(out).toContain('data-setting="grid"');
    expect(out).toContain('data-ref="grid-switch"');
  });

  it("passes the disabled attribute through", async () => {
    const withDisabled = await render(<Switch disabled />);
    const withoutDisabled = await render(<Switch />);
    expect(withDisabled).toMatch(/\bdisabled(?!:)/);
    expect(withoutDisabled).not.toMatch(/\bdisabled(?!:)/);
  });

  it("merges a custom class with the base wrapper classes", async () => {
    const out = await render(<Switch class='extra-class' />);
    expect(out).toContain("extra-class");
    expect(out).toContain("inline-flex");
  });

  it("wires field id and name from the descriptor", async () => {
    const out = await render(<Switch field={{ name: "grid" }} />);
    expect(out).toContain('id="field-grid"');
    expect(out).toContain('name="grid"');
  });

  it("adds aria-invalid and aria-describedby when the field is invalid", async () => {
    const out = await render(<Switch field={{ name: "grid", invalid: true }} />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="field-grid-description field-grid-error"');
  });

  it("renders label children inside the wrapper", async () => {
    const out = await render(<Switch>Snap to grid</Switch>);
    expect(out).toContain("Snap to grid");
  });
});
