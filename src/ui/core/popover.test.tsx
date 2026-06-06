/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Popover } from "./popover";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("Popover", () => {
  it("renders a <details> element with data-slot=popover", async () => {
    const out = await render(<Popover />);
    expect(out).toContain("<details");
    expect(out).toContain('data-slot="popover"');
  });

  it("renders relative inline-block positioning classes", async () => {
    const out = await render(<Popover />);
    expect(out).toContain("relative");
    expect(out).toContain("inline-block");
  });

  it("passes the open attribute through", async () => {
    const out = await render(<Popover open />);
    expect(out).toContain("open");
  });

  it("merges a custom class", async () => {
    const out = await render(<Popover class='my-popover' />);
    expect(out).toContain("my-popover");
    expect(out).toContain("relative");
  });
});

describe("Popover.Trigger", () => {
  it("renders a <summary> with data-slot=popover-trigger", async () => {
    const out = await render(<Popover.Trigger>Open</Popover.Trigger>);
    expect(out).toContain("<summary");
    expect(out).toContain('data-slot="popover-trigger"');
    expect(out).toContain("Open");
  });

  it("suppresses the default disclosure marker via list-none", async () => {
    const out = await render(<Popover.Trigger>Open</Popover.Trigger>);
    expect(out).toContain("list-none");
  });

  it("merges a custom class", async () => {
    const out = await render(<Popover.Trigger class='my-trigger'>Click</Popover.Trigger>);
    expect(out).toContain("my-trigger");
  });
});

describe("Popover.Content", () => {
  it("renders a <div> with data-slot=popover-content", async () => {
    const out = await render(<Popover.Content>Items</Popover.Content>);
    expect(out).toContain("<div");
    expect(out).toContain('data-slot="popover-content"');
    expect(out).toContain("Items");
  });

  it("defaults to start align and bottom side", async () => {
    const out = await render(<Popover.Content>Items</Popover.Content>);
    expect(out).toContain('data-align="start"');
    expect(out).toContain('data-side="bottom"');
    expect(out).toContain("left-0");
    expect(out).toContain("top-full");
  });

  it("renders end align class", async () => {
    const out = await render(<Popover.Content align='end'>Items</Popover.Content>);
    expect(out).toContain('data-align="end"');
    expect(out).toContain("right-0");
  });

  it("renders center align classes", async () => {
    const out = await render(<Popover.Content align='center'>Items</Popover.Content>);
    expect(out).toContain("-translate-x-1/2");
  });

  it("renders top side classes", async () => {
    const out = await render(<Popover.Content side='top'>Items</Popover.Content>);
    expect(out).toContain('data-side="top"');
    expect(out).toContain("bottom-full");
  });

  it("renders absolute positioning and z-index", async () => {
    const out = await render(<Popover.Content>Items</Popover.Content>);
    expect(out).toContain("absolute");
    expect(out).toContain("z-50");
    expect(out).toContain("bg-popover");
  });

  it("merges a custom class", async () => {
    const out = await render(<Popover.Content class='w-64'>Items</Popover.Content>);
    expect(out).toContain("w-64");
    expect(out).toContain("absolute");
  });
});

describe("Popover composition", () => {
  it("renders the full popover structure", async () => {
    const out = await render(
      <Popover>
        <Popover.Trigger>Open menu</Popover.Trigger>
        <Popover.Content>
          <div>Item 1</div>
        </Popover.Content>
      </Popover>,
    );
    expect(out).toContain('data-slot="popover"');
    expect(out).toContain('data-slot="popover-trigger"');
    expect(out).toContain('data-slot="popover-content"');
    expect(out).toContain("Open menu");
    expect(out).toContain("Item 1");
  });
});
