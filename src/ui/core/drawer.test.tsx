/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Drawer } from "./drawer";

const BASE = "fixed m-0 flex flex-col border-field border-border bg-popover p-0 text-popover-foreground shadow-lg";
const INLINE_AXIS = "h-dvh max-h-none w-80 max-w-[85vw]";
const BLOCK_AXIS = "h-auto max-h-[85vh] w-full max-w-none";

describe("Drawer", () => {
  it("anchors to the left by default", async () => {
    expect(await render(<Drawer id='nav'>Body</Drawer>)).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" closedby="any" class="${BASE} ${INLINE_AXIS}" data-side="left">Body</dialog>`,
    );
  });

  it("stamps the side it was given", async () => {
    expect(await render(<Drawer id='nav' side='right' />)).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" closedby="any" class="${BASE} ${INLINE_AXIS}" data-side="right"></dialog>`,
    );
  });

  it("fills the inline axis on a block-axis side", async () => {
    expect(await render(<Drawer id='nav' side='top' />)).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" closedby="any" class="${BASE} ${BLOCK_AXIS}" data-side="top"></dialog>`,
    );
  });

  it("lets a caller's width evict the default", async () => {
    expect(await render(<Drawer id='nav' class='w-96' />)).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" closedby="any" class="${BASE} h-dvh max-h-none max-w-[85vw] w-96" data-side="left"></dialog>`,
    );
  });

  it("renders open and non-modal when open is set", async () => {
    expect(await render(<Drawer id='nav' open />)).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" open closedby="any" class="${BASE} ${INLINE_AXIS}" data-side="left"></dialog>`,
    );
  });

  it("stamps the dialog scope and the resume marker for openModal, and never the open attribute", async () => {
    expect(await render(<Drawer id='nav' openModal />)).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" data-scope="dialog" data-open-modal="" closedby="any" class="${BASE} ${INLINE_AXIS}" data-side="left"></dialog>`,
    );
  });
});

describe("Drawer.Title", () => {
  it("derives its id from the drawer's, so aria-labelledby resolves to the rendered heading", async () => {
    const html = await render(
      <Drawer id='nav'>
        <Drawer.Title for='nav'>Navigation</Drawer.Title>
      </Drawer>,
    );

    expect(html).toBe(
      `<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" closedby="any" class="${BASE} ${INLINE_AXIS}" data-side="left">` +
        '<h2 data-slot="drawer-title" id="nav-title" class="text-base font-semibold">Navigation</h2>' +
        "</dialog>",
    );
  });

  // Only the tag may vary: `data-slot`, the class and the derived `id` are what the stylesheet, the
  // hand-written-DOM path and `aria-labelledby` all read.
  it("renders each level as its own tag, leaving data-slot, class and id untouched", async () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      expect(
        await render(
          <Drawer.Title for='nav' level={level}>
            t
          </Drawer.Title>,
        ),
      ).toBe(`<h${level} data-slot="drawer-title" id="nav-title" class="text-base font-semibold">t</h${level}>`);
    }
  });
});

describe("Drawer.Trigger", () => {
  it("opens the drawer as a modal through an invoker command", async () => {
    expect(await render(<Drawer.Trigger for='nav'>Menu</Drawer.Trigger>)).toBe(
      '<button type="button" data-slot="drawer-trigger" command="show-modal" commandfor="nav">Menu</button>',
    );
  });
});

describe("Drawer.Close", () => {
  it("emits command=close by default", async () => {
    expect(await render(<Drawer.Close for='nav'>Done</Drawer.Close>)).toBe(
      '<button type="button" data-slot="drawer-close" command="close" commandfor="nav">Done</button>',
    );
  });

  it("emits command=request-close when request is set", async () => {
    expect(
      await render(
        <Drawer.Close for='nav' request class='text-sm'>
          Done
        </Drawer.Close>,
      ),
    ).toBe('<button type="button" data-slot="drawer-close" command="request-close" commandfor="nav" class="text-sm">Done</button>');
  });
});

describe("Drawer sections", () => {
  it("renders the header band", async () => {
    expect(await render(<Drawer.Header>Menu</Drawer.Header>)).toBe(
      '<div data-slot="drawer-header" class="grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5">Menu</div>',
    );
  });

  it("renders the content band as the scrolling middle", async () => {
    expect(await render(<Drawer.Content>Links</Drawer.Content>)).toBe(
      '<div data-slot="drawer-content" class="min-h-0 flex-1 overflow-y-auto px-6 py-5">Links</div>',
    );
  });

  it("renders the footer band", async () => {
    expect(await render(<Drawer.Footer>Actions</Drawer.Footer>)).toBe(
      '<div data-slot="drawer-footer" class="flex items-center gap-2 border-t border-border px-6 py-4">Actions</div>',
    );
  });
});
