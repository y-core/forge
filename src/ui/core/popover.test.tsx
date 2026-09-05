/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { POPOVER_SCOPE } from "../contracts/overlay-contract";
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

describe("Popover.Trigger — data-slot", () => {
  const TRIGGER_CLASS = "cursor-pointer list-none focus-ring";

  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Popover.Trigger for='p' />)).toBe(
      `<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="p" aria-controls="p" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Popover.Trigger for='p' data-slot='rail-tool' />)).toBe(
      `<button type="button" data-slot="popover-trigger rail-tool" command="toggle-popover" commandfor="p" aria-controls="p" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Popover.Trigger for='p' data-slot='' />)).toBe(
      `<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="p" aria-controls="p" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });
});

describe("Popover.Trigger", () => {
  it("renders a <button> invoker with command=toggle-popover targeting the content id", async () => {
    expect(await render(<Popover.Trigger for='menu-1'>Open</Popover.Trigger>)).toBe(
      '<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-1" aria-controls="menu-1" aria-expanded="false" class="cursor-pointer list-none focus-ring">Open</button>',
    );
  });

  it("uses `for` only as commandfor, never as the button's own id", async () => {
    expect(await render(<Popover.Trigger for='menu-1'>Open</Popover.Trigger>)).toBe(
      '<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-1" aria-controls="menu-1" aria-expanded="false" class="cursor-pointer list-none focus-ring">Open</button>',
    );
  });

  it("merges a custom class", async () => {
    expect(
      await render(
        <Popover.Trigger for='menu-1' class='my-trigger'>
          Click
        </Popover.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-1" aria-controls="menu-1" aria-expanded="false" class="cursor-pointer list-none focus-ring my-trigger">Click</button>',
    );
  });
});

describe("Popover.Content", () => {
  it("renders a native popover <div> with the linking id and data-slot=popover-content", async () => {
    expect(await render(<Popover.Content id='menu-1'>Items</Popover.Content>)).toBe(
      `<div id="menu-1" data-slot="popover-content" data-scope="${POPOVER_SCOPE}" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>`,
    );
  });

  it("defaults to start align and bottom side", async () => {
    expect(await render(<Popover.Content id='menu-1'>Items</Popover.Content>)).toBe(
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
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
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="end" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
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
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="center" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
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
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="top" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders left side", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' side='left'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="left" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders right side", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' side='right'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
    );
  });

  it("renders the popover panel chrome classes", async () => {
    expect(await render(<Popover.Content id='menu-1'>Items</Popover.Content>)).toBe(
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md">Items</div>',
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
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md w-64">Items</div>',
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
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md" role="menu" data-note="a&amp;b">Items</div>',
    );
  });
});

describe("Popover composition", () => {
  it("renders the full popover structure, the trigger's `for` naming the content's `id`", async () => {
    expect(
      await render(
        <Popover>
          <Popover.Trigger for='menu-file'>Open menu</Popover.Trigger>
          <Popover.Content id='menu-file'>
            <div>Item 1</div>
          </Popover.Content>
        </Popover>,
      ),
    ).toBe(
      '<div data-slot="popover" class="relative inline-block"><button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="menu-file" aria-controls="menu-file" aria-expanded="false" class="cursor-pointer list-none focus-ring">Open menu</button><div id="menu-file" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md"><div>Item 1</div></div></div>',
    );
  });
});
