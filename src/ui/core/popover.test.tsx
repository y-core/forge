/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Popover } from "./popover";

describe("Popover", () => {
  it("renders a <div> wrapper with data-slot=popover", async () => {
    expect(await render(<Popover />)).toBe('<div data-slot="popover" class="relative inline-block"></div>');
  });

  it("renders relative inline-block positioning classes", async () => {
    expect(await render(<Popover />)).toBe('<div data-slot="popover" class="relative inline-block"></div>');
  });

  it("merges a custom class", async () => {
    expect(await render(<Popover class='my-popover' />)).toBe('<div data-slot="popover" class="relative inline-block my-popover"></div>');
  });
});

describe("Popover.Trigger", () => {
  it("renders a <button> invoker with command=toggle-popover targeting the content id", async () => {
    expect(await render(<Popover.Trigger id='menu-1'>Open</Popover.Trigger>)).toBe(
      '<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-1" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">Open</button>',
    );
  });

  it("uses the id only as commandfor, never as the button's own id", async () => {
    expect(await render(<Popover.Trigger id='menu-1'>Open</Popover.Trigger>)).toBe(
      '<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-1" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">Open</button>',
    );
  });

  it("merges a custom class", async () => {
    expect(
      await render(
        <Popover.Trigger id='menu-1' class='my-trigger'>
          Click
        </Popover.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-1" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring my-trigger">Click</button>',
    );
  });
});

describe("Popover.Content", () => {
  it("renders a native popover <div> with the linking id and data-slot=popover-content", async () => {
    expect(await render(<Popover.Content id='menu-1'>Items</Popover.Content>)).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("defaults to start align and bottom side", async () => {
    expect(await render(<Popover.Content id='menu-1'>Items</Popover.Content>)).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders end align", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' align='end'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="end" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders center align", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' align='center'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="center" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders top side", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' side='top'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="top" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders the popover panel chrome classes", async () => {
    expect(await render(<Popover.Content id='menu-1'>Items</Popover.Content>)).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("merges a custom class", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' class='w-64'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md w-64">Items</div>',
    );
  });

  it("forwards role and data-* attributes with HTML-escaped values", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' role='menu' data-note='a&b'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md" role="menu" data-note="a&amp;b">Items</div>',
    );
  });
});

describe("Popover composition", () => {
  it("renders the full popover structure with a shared id", async () => {
    expect(
      await render(
        <Popover>
          <Popover.Trigger id='menu-file'>Open menu</Popover.Trigger>
          <Popover.Content id='menu-file'>
            <div>Item 1</div>
          </Popover.Content>
        </Popover>,
      ),
    ).toBe(
      '<div data-slot="popover" class="relative inline-block"><button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-file" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">Open menu</button><div id="menu-file" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"><div>Item 1</div></div></div>',
    );
  });
});
