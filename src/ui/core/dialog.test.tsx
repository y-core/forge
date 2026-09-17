/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "./core.fixture";
import { Dialog } from "./dialog";

const contentOf = (html: string): string => html.slice(tagOf(html).length, html.lastIndexOf("<"));

describe("Dialog", () => {
  it("renders the whole dialog exactly, caller class merged last and children escaped", async () => {
    expect(
      await render(
        <Dialog id='confirm' class='w-96' data-note="a&b's">
          {`R&D's <plan>`}
        </Dialog>,
      ),
    ).toBe(
      '<dialog id="confirm" data-slot="dialog" aria-labelledby="confirm-title" closedby="any"' +
        ' class="rounded-box border border-border bg-popover text-popover-foreground shadow-lg w-96" data-note="a&amp;b&#39;s">' +
        "R&amp;D&#39;s &lt;plan&gt;</dialog>",
    );
  });

  it("names a heading it has not seen and opts into light dismiss, both derived from the one written id", async () => {
    expect(attrsOf(await render(<Dialog id='confirm'>Body</Dialog>))).toEqual({
      id: "confirm",
      "data-slot": "dialog",
      "aria-labelledby": "confirm-title",
      closedby: "any",
    });
  });

  // Both attributes together is the one markup `showModal()` throws `InvalidStateError` on, and the
  // reader is left with no dialog at all — so `openModal` wins and `open` never reaches the markup.
  it("drops the non-modal open attribute when the caller asks for a modal as well", async () => {
    const attrs = attrsOf(await render(<Dialog id='confirm' open openModal />));

    expect(attrs["data-open-modal"]).toBe("");
    expect(attrs["data-scope"]).toBe("dialog");
    expect(attrs.open).toBeUndefined();
  });

  it("still renders a plain open dialog non-modal, with neither scope nor modal marker", async () => {
    const attrs = attrsOf(await render(<Dialog id='confirm' open />));

    expect(attrs.open).toBe("");
    expect(attrs["data-scope"]).toBeUndefined();
  });
});

describe("Dialog.Title", () => {
  it("derives its id from the dialog's, so aria-labelledby resolves to the rendered heading", async () => {
    const html = await render(
      <Dialog id='confirm'>
        <Dialog.Title for='confirm'>Delete project?</Dialog.Title>
      </Dialog>,
    );

    expect(attrOf(html, "id", 'data-slot="dialog-title"')).toBe("confirm-title");
    expect(attrOf(html, "aria-labelledby", 'data-slot="dialog"')).toBe("confirm-title");
  });

  it("renders each level as its own tag, leaving the slot token, the derived id and the class untouched", async () => {
    const base = await render(<Dialog.Title for='confirm'>t</Dialog.Title>);

    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const html = await render(
        <Dialog.Title for='confirm' level={level}>
          t
        </Dialog.Title>,
      );

      expect(tagOf(html).startsWith(`<h${level} `)).toBe(true);
      expect(attrsOf(html)).toEqual({ "data-slot": "dialog-title", id: "confirm-title" });
      expect(classesOf(html)).toEqual(classesOf(base));
      expect(contentOf(html)).toBe("t");
    }
  });
});

describe("Dialog.Trigger", () => {
  it("opens the dialog as a modal through an invoker command, needing no script of its own", async () => {
    const html = await render(<Dialog.Trigger for='confirm'>Open</Dialog.Trigger>);

    expect(attrsOf(html)).toEqual({ type: "button", "data-slot": "dialog-trigger", command: "show-modal", commandfor: "confirm" });
    expect(contentOf(html)).toBe("Open");
  });
});

describe("Dialog.Close", () => {
  it("closes the dialog outright by default, through the same invoker mechanism", async () => {
    expect(attrsOf(await render(<Dialog.Close for='confirm'>Cancel</Dialog.Close>))).toEqual({
      type: "button",
      "data-slot": "dialog-close",
      command: "close",
      commandfor: "confirm",
    });
  });

  it("runs the cancelable close-request algorithm instead when the caller asks for one", async () => {
    expect(
      attrOf(
        await render(
          <Dialog.Close for='confirm' request>
            Cancel
          </Dialog.Close>,
        ),
        "command",
      ),
    ).toBe("request-close");
  });

  it("wears the caller's class and nothing of its own, since a close button is styled where it sits", async () => {
    expect(
      classesOf(
        await render(
          <Dialog.Close for='confirm' class='text-sm'>
            Cancel
          </Dialog.Close>,
        ),
      ),
    ).toEqual(["text-sm"]);
  });
});

describe("Dialog sections", () => {
  it("renders the three bands as divs under their own slot tokens", async () => {
    expect(attrsOf(await render(<Dialog.Header>Delete project</Dialog.Header>))).toEqual({ "data-slot": "dialog-header" });
    expect(attrsOf(await render(<Dialog.Content>This cannot be undone.</Dialog.Content>))).toEqual({ "data-slot": "dialog-content" });
    expect(attrsOf(await render(<Dialog.Footer>Actions</Dialog.Footer>))).toEqual({ "data-slot": "dialog-footer" });
  });

  it("rules the header off below and the footer off above, so the body reads as the panel between them", async () => {
    expect(classesOf(await render(<Dialog.Header>h</Dialog.Header>)).filter((token) => token.startsWith("border-"))).toEqual([
      "border-b",
      "border-border",
    ]);
    expect(classesOf(await render(<Dialog.Footer>f</Dialog.Footer>)).filter((token) => token.startsWith("border-"))).toEqual([
      "border-t",
      "border-border",
    ]);
  });

  it("lets a caller's padding evict the section default rather than stacking a second one", async () => {
    expect(
      variantClasses(await render(<Dialog.Content class='p-2'>Body</Dialog.Content>), await render(<Dialog.Content>Body</Dialog.Content>)),
    ).toEqual({ added: ["p-2"], dropped: ["px-6", "py-5"] });
  });
});

describe("Dialog composition", () => {
  it("links a trigger and a close to the dialog by the one id the caller wrote", async () => {
    const html = await render(
      <>
        <Dialog.Trigger for='confirm'>Delete…</Dialog.Trigger>
        <Dialog id='confirm'>
          <p>Are you sure?</p>
          <Dialog.Close for='confirm'>Cancel</Dialog.Close>
        </Dialog>
      </>,
    );

    expect(attrOf(html, "id", 'data-slot="dialog"')).toBe("confirm");
    expect(attrOf(html, "commandfor", 'data-slot="dialog-trigger"')).toBe("confirm");
    expect(attrOf(html, "commandfor", 'data-slot="dialog-close"')).toBe("confirm");
  });
});

describe("Dialog — the name the root resolves to", () => {
  it("takes the caller's own name and drops the derived reference, which would name a heading they did not write", async () => {
    const byRef = attrsOf(
      await render(
        <Dialog id='confirm' labelledby='filters-trigger'>
          Body
        </Dialog>,
      ),
    );
    const byLabel = attrsOf(
      await render(
        <Dialog id='confirm' label='Filters'>
          Body
        </Dialog>,
      ),
    );

    expect(byRef["aria-labelledby"]).toBe("filters-trigger");
    expect(byLabel["aria-labelledby"]).toBeUndefined();
    expect(byLabel["aria-label"]).toBe("Filters");
  });

  // Single-pass SSR cannot see whether a `.Title` child exists, so the derived reference is still
  // written and dangles. The name is absent either way; this pins the gap rather than hiding it.
  it("is provably nameless with neither a title nor a name prop, its reference resolving to nothing", async () => {
    const html = await render(<Dialog id='confirm'>Body</Dialog>);
    const named = attrOf(html, "aria-labelledby", 'data-slot="dialog"');

    expect(named).toBe("confirm-title");
    expect(tagOf(html, `id="${named}"`)).toBe("");
    expect(attrsOf(html)["aria-label"]).toBeUndefined();
  });
});
