import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { ToggleGroup } from "./toggle-group";

describe("ToggleGroup", () => {
  it("root emits data-slot=toggle-group on a fieldset", async () => {
    const out = await render(<ToggleGroup aria-label='Projection' data-ref='projection-group' />);
    expect(out).toContain('data-slot="toggle-group"');
    expect(out).toContain("<fieldset");
    expect(out).toContain('aria-label="Projection"');
    expect(out).toContain('data-ref="projection-group"');
  });

  it("root includes base layout classes", async () => {
    const out = await render(<ToggleGroup />);
    expect(out).toContain("flex");
    expect(out).toContain("justify-center");
  });

  it("root merges a custom class with the base classes", async () => {
    const out = await render(<ToggleGroup class='extra-root' />);
    expect(out).toContain("extra-root");
    expect(out).toContain("flex");
  });

  it("item emits data-slot=toggle-group-item, type=button, and aria-pressed=false by default", async () => {
    const out = await render(<ToggleGroup.Item>Label</ToggleGroup.Item>);
    expect(out).toContain('data-slot="toggle-group-item"');
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-pressed="false"');
  });

  it("item with pressed=true emits aria-pressed=true and active bg class", async () => {
    const out = await render(<ToggleGroup.Item pressed>Active</ToggleGroup.Item>);
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain("bg-primary");
  });

  it("item without pressed emits aria-pressed=false and no active bg class", async () => {
    const out = await render(<ToggleGroup.Item>Inactive</ToggleGroup.Item>);
    expect(out).toContain('aria-pressed="false"');
    expect(out).not.toContain("bg-primary");
  });

  it("item spreads data-on-click, data-mode, data-ref, and title", async () => {
    const out = await render(
      <ToggleGroup.Item data-on-click='cameraMode' data-mode='perspective' data-ref='cam-perspective' title='Perspective'>
        P
      </ToggleGroup.Item>,
    );
    expect(out).toContain('data-on-click="cameraMode"');
    expect(out).toContain('data-mode="perspective"');
    expect(out).toContain('data-ref="cam-perspective"');
    expect(out).toContain('title="Perspective"');
  });

  it("item renders text children", async () => {
    const out = await render(<ToggleGroup.Item>perspective</ToggleGroup.Item>);
    expect(out).toContain("perspective");
  });

  it("item merges a custom class with the base classes", async () => {
    const out = await render(<ToggleGroup.Item class='extra-cls'>X</ToggleGroup.Item>);
    expect(out).toContain("extra-cls");
    expect(out).toContain("inline-flex");
  });

  it("item renders label children inside a full group", async () => {
    const out = await render(
      <ToggleGroup aria-label='Views'>
        <ToggleGroup.Item pressed data-ref='perspective-btn'>
          Perspective
        </ToggleGroup.Item>
        <ToggleGroup.Item data-ref='parallel-btn'>Parallel</ToggleGroup.Item>
      </ToggleGroup>,
    );
    expect(out).toContain('data-slot="toggle-group"');
    expect(out).toContain('data-slot="toggle-group-item"');
    expect(out).toContain("Perspective");
    expect(out).toContain("Parallel");
  });

  it("defaults to horizontal orientation with no data-orientation attribute override", async () => {
    const out = await render(<ToggleGroup />);
    expect(out).toContain('data-orientation="horizontal"');
    expect(out).toContain('aria-orientation="horizontal"');
    expect(out).not.toContain("flex-col");
  });

  it("vertical orientation stamps data-orientation and adds flex-col to the group", async () => {
    const out = await render(<ToggleGroup orientation='vertical' />);
    expect(out).toContain('data-orientation="vertical"');
    expect(out).toContain('aria-orientation="vertical"');
    expect(out).toContain("flex-col");
  });

  it("item includes the arbitrary vertical ancestor variant class for border override", async () => {
    const out = await render(<ToggleGroup.Item>X</ToggleGroup.Item>);
    expect(out).toContain("[data-slot=toggle-group][data-orientation=vertical]");
  });

  it("item carries vertical rounded-t-md and rounded-b-md but not rounded-l-none or rounded-r-none overrides", async () => {
    const out = await render(<ToggleGroup.Item>X</ToggleGroup.Item>);
    expect(out).toContain("]:first:rounded-t-md");
    expect(out).toContain("]:last:rounded-b-md");
    expect(out).not.toContain("]:first:rounded-l-none");
    expect(out).not.toContain("]:last:rounded-r-none");
  });
});
