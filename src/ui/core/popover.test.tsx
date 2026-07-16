/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Popover } from "./popover";

describe("Popover", () => {
  it("renders a <div> wrapper with data-slot=popover", async () => {
    const out = await render(<Popover />);
    expect(out).toContain("<div");
    expect(out).toContain('data-slot="popover"');
  });

  it("renders relative inline-block positioning classes", async () => {
    const out = await render(<Popover />);
    expect(out).toContain("relative");
    expect(out).toContain("inline-block");
  });

  it("merges a custom class", async () => {
    const out = await render(<Popover class='my-popover' />);
    expect(out).toContain("my-popover");
    expect(out).toContain("relative");
  });
});

describe("Popover.Trigger", () => {
  it("renders a <button> invoker with command=toggle-popover targeting the content id", async () => {
    const out = await render(<Popover.Trigger id='menu-1'>Open</Popover.Trigger>);
    expect(out).toContain("<button");
    expect(out).toContain('type="button"');
    expect(out).toContain('data-slot="popover-trigger"');
    expect(out).toContain('command="toggle-popover"');
    expect(out).toContain('commandfor="menu-1"');
    expect(out).toContain("Open");
  });

  it("uses the id only as commandfor, never as the button's own id", async () => {
    const out = await render(<Popover.Trigger id='menu-1'>Open</Popover.Trigger>);
    expect(out).not.toContain('id="menu-1"');
  });

  it("merges a custom class", async () => {
    const out = await render(
      <Popover.Trigger id='menu-1' class='my-trigger'>
        Click
      </Popover.Trigger>,
    );
    expect(out).toContain("my-trigger");
  });
});

describe("Popover.Content", () => {
  it("renders a native popover <div> with the linking id and data-slot=popover-content", async () => {
    const out = await render(<Popover.Content id='menu-1'>Items</Popover.Content>);
    expect(out).toContain("<div");
    expect(out).toContain('data-slot="popover-content"');
    expect(out).toContain('id="menu-1"');
    expect(out).toContain('popover="auto"');
    expect(out).toContain("Items");
  });

  it("defaults to start align and bottom side", async () => {
    const out = await render(<Popover.Content id='menu-1'>Items</Popover.Content>);
    expect(out).toContain('data-align="start"');
    expect(out).toContain('data-side="bottom"');
  });

  it("renders end align", async () => {
    const out = await render(
      <Popover.Content id='menu-1' align='end'>
        Items
      </Popover.Content>,
    );
    expect(out).toContain('data-align="end"');
  });

  it("renders center align", async () => {
    const out = await render(
      <Popover.Content id='menu-1' align='center'>
        Items
      </Popover.Content>,
    );
    expect(out).toContain('data-align="center"');
  });

  it("renders top side", async () => {
    const out = await render(
      <Popover.Content id='menu-1' side='top'>
        Items
      </Popover.Content>,
    );
    expect(out).toContain('data-side="top"');
  });

  it("renders the popover panel chrome classes", async () => {
    const out = await render(<Popover.Content id='menu-1'>Items</Popover.Content>);
    expect(out).toContain("z-50");
    expect(out).toContain("bg-popover");
  });

  it("merges a custom class", async () => {
    const out = await render(
      <Popover.Content id='menu-1' class='w-64'>
        Items
      </Popover.Content>,
    );
    expect(out).toContain("w-64");
    expect(out).toContain("bg-popover");
  });
});

describe("Popover composition", () => {
  it("renders the full popover structure with a shared id", async () => {
    const out = await render(
      <Popover>
        <Popover.Trigger id='menu-file'>Open menu</Popover.Trigger>
        <Popover.Content id='menu-file'>
          <div>Item 1</div>
        </Popover.Content>
      </Popover>,
    );
    expect(out).toContain('data-slot="popover"');
    expect(out).toContain('data-slot="popover-trigger"');
    expect(out).toContain('data-slot="popover-content"');
    expect(out).toContain('commandfor="menu-file"');
    expect(out).toContain('id="menu-file"');
    expect(out).toContain('popover="auto"');
    expect(out).toContain("Open menu");
    expect(out).toContain("Item 1");
  });
});
