/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import type { JSXNode } from "../../render/jsx/types";
import { attrOf, attrsOf, classesOf, innerOf, tagOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Drawer } from "./drawer";

describe("Drawer", () => {
  it("renders the whole panel exactly, caller class merged last and children escaped", async () => {
    expect(
      await render(
        <Drawer id='nav' titled class='w-96' data-note="a&b's">
          {`R&D's <menu>`}
        </Drawer>,
      ),
    ).toBe(
      '<dialog id="nav" data-slot="drawer" aria-labelledby="nav-title" closedby="any"' +
        ' class="fixed z-40 m-0 flex-col border-field border-border bg-popover p-0 text-popover-foreground shadow-lg open:flex h-dvh max-h-none max-w-[85vw] w-96"' +
        ' data-side="left" data-note="a&amp;b&#39;s">R&amp;D&#39;s &lt;menu&gt;</dialog>',
    );
  });

  it("anchors to the left unless told otherwise, and names the edge where a controller can read it", async () => {
    expect(
      attrsOf(
        await render(
          <Drawer id='nav' titled>
            Body
          </Drawer>,
        ),
      ),
    ).toEqual({ id: "nav", "data-slot": "drawer", "aria-labelledby": "nav-title", closedby: "any", "data-side": "left" });
    expect(attrOf(await render(<Drawer id='nav' titled side='right' />), "data-side")).toBe("right");
  });

  it("fills the panel's own axis, so a top drawer spans the inline axis instead of the block one", async () => {
    expect(variantClasses(await render(<Drawer id='nav' titled side='top' />), await render(<Drawer id='nav' titled />))).toEqual({
      added: ["h-auto", "max-h-[85vh]", "w-full", "max-w-none"],
      dropped: ["h-dvh", "max-h-none", "w-80", "max-w-[85vw]"],
    });
  });

  it("lets a caller's width evict the default rather than stacking a second one", async () => {
    expect(variantClasses(await render(<Drawer id='nav' titled class='w-96' />), await render(<Drawer id='nav' titled />))).toEqual({
      added: ["w-96"],
      dropped: ["w-80"],
    });
  });

  it("renders open and non-modal when open is set, without the closedby that would dismiss it on any page click", async () => {
    expect(attrsOf(await render(<Drawer id='nav' titled open />))).toEqual({
      id: "nav",
      "data-slot": "drawer",
      "aria-labelledby": "nav-title",
      open: "",
      "data-side": "left",
    });
  });

  // Both attributes together leaves `showModal()` skipped on resume, and the drawer renders non-modal
  // — no top layer, no inertness, no backdrop — with nothing in the markup to say so.
  it("drops the non-modal open attribute when the caller asks for a modal as well", async () => {
    const html = await render(<Drawer id='nav' titled open openModal />);
    const attrs = attrsOf(html);

    expect(tagOf(html, 'data-open-modal=""')).toBe(tagOf(html));
    expect(attrs["data-scope"]).toBe("dialog");
    expect(attrs.open).toBeUndefined();
  });

  it("stamps the dialog scope and the resume marker for openModal, and never the open attribute a modal must not carry", async () => {
    const html = await render(<Drawer id='nav' titled openModal />);

    expect(attrsOf(html)).toEqual({
      id: "nav",
      "data-slot": "drawer",
      "aria-labelledby": "nav-title",
      "data-scope": "dialog",
      "data-open-modal": "",
      closedby: "any",
      "data-side": "left",
    });
    expect(tagOf(html, 'data-open-modal=""')).toBe(tagOf(html));
  });
});

describe("Drawer — described by its own .Description", () => {
  it("points aria-describedby at the Description derived from the drawer's id, which carries that id", async () => {
    const html = await render(
      <Drawer id='nav' titled described>
        <Drawer.Description for='nav'>m</Drawer.Description>
      </Drawer>,
    );

    expect(attrOf(html, "aria-describedby", 'data-slot="drawer"')).toBe("nav-description");
    expect(attrOf(html, "id", 'data-slot="drawer-description"')).toBe("nav-description");
  });

  it("lists a caller's aria-describedby ahead of the Description reference rather than replacing it", async () => {
    const html = await render(
      <Drawer id='nav' titled described aria-describedby='hint'>
        <Drawer.Description for='nav'>m</Drawer.Description>
      </Drawer>,
    );

    expect(attrOf(html, "aria-describedby", 'data-slot="drawer"')).toBe("hint nav-description");
  });
});

describe("Drawer — alert", () => {
  it("announces as an alertdialog that only an explicit close request dismisses", async () => {
    expect(attrsOf(await render(<Drawer id='nav' titled alert />))).toEqual({
      id: "nav",
      "data-slot": "drawer",
      role: "alertdialog",
      "aria-labelledby": "nav-title",
      closedby: "closerequest",
      "data-side": "left",
    });
  });
});

describe("Drawer.Title", () => {
  it("derives its id from the drawer's, so aria-labelledby resolves to the rendered heading", async () => {
    const html = await render(
      <Drawer id='nav' titled>
        <Drawer.Title for='nav'>Navigation</Drawer.Title>
      </Drawer>,
    );

    expect(attrOf(html, "id", 'data-slot="drawer-title"')).toBe("nav-title");
    expect(attrOf(html, "aria-labelledby", 'data-slot="drawer"')).toBe("nav-title");
  });

  it("renders each level as its own tag, leaving the slot token, the derived id and the class untouched", async () => {
    const base = await render(<Drawer.Title for='nav'>t</Drawer.Title>);

    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const html = await render(
        <Drawer.Title for='nav' level={level}>
          t
        </Drawer.Title>,
      );

      expect(tagOf(html).startsWith(`<h${level} `)).toBe(true);
      expect(attrsOf(html)).toEqual({ "data-slot": "drawer-title", id: "nav-title" });
      expect(classesOf(html)).toEqual(classesOf(base));
      expect(innerOf(html)).toBe("t");
    }
  });
});

describe("Drawer.Trigger", () => {
  it("opens the drawer as a modal through an invoker command, needing no script of its own", async () => {
    const html = await render(<Drawer.Trigger for='nav'>Menu</Drawer.Trigger>);

    expect(attrsOf(html)).toEqual({ type: "button", "data-slot": "drawer-trigger", command: "show-modal", commandfor: "nav" });
    expect(innerOf(html)).toBe("Menu");
  });
});

describe("Drawer.Close", () => {
  it("closes the drawer outright by default, through the same invoker mechanism", async () => {
    expect(attrsOf(await render(<Drawer.Close for='nav'>Done</Drawer.Close>))).toEqual({
      type: "button",
      "data-slot": "drawer-close",
      command: "close",
      commandfor: "nav",
    });
  });

  it("runs the cancelable close-request algorithm when asked", async () => {
    const html = await render(
      <Drawer.Close for='nav' request>
        Done
      </Drawer.Close>,
    );

    expect(attrOf(html, "command")).toBe("request-close");
  });
});

describe("Drawer.Trigger and Drawer.Close — the sm button box", () => {
  const invokers = [Drawer.Trigger, Drawer.Close] as const;

  it("clears the Floor bare, with the sm height, a focus ring and an unpainted border", async () => {
    for (const Invoker of invokers) {
      const classes = classesOf(await render(<Invoker for='nav'>Go</Invoker>));

      for (const token of ["h-control-sm", "focus-ring", "border-transparent"]) expect(classes).toContain(token);
    }
  });

  it("lets a caller's conflicting class evict the box's own while the height stays", async () => {
    for (const Invoker of invokers) {
      const classes = classesOf(
        await render(
          <Invoker for='nav' class='px-6 text-base'>
            Go
          </Invoker>,
        ),
      );

      for (const token of ["px-6", "text-base", "h-control-sm"]) expect(classes).toContain(token);
      expect(classes).not.toContain("px-3");
      expect(classes).not.toContain("text-sm");
    }
  });
});

describe("Drawer sections", () => {
  it("renders the three bands as divs under their own slot tokens", async () => {
    expect(attrsOf(await render(<Drawer.Header>Menu</Drawer.Header>))).toEqual({ "data-slot": "drawer-header" });
    expect(attrsOf(await render(<Drawer.Content>Links</Drawer.Content>))).toEqual({ "data-slot": "drawer-content" });
    expect(attrsOf(await render(<Drawer.Footer>Actions</Drawer.Footer>))).toEqual({ "data-slot": "drawer-footer" });
  });

  it("scrolls the content band alone, with the header and footer ruled off and pinned either side of it", async () => {
    expect(classesOf(await render(<Drawer.Content>Links</Drawer.Content>)).filter((token) => token.startsWith("overflow-"))).toEqual([
      "overflow-y-auto",
    ]);
    expect(classesOf(await render(<Drawer.Header>Menu</Drawer.Header>)).filter((token) => token.startsWith("border-"))).toEqual([
      "border-b",
      "border-border",
    ]);
    expect(classesOf(await render(<Drawer.Footer>Actions</Drawer.Footer>)).filter((token) => token.startsWith("border-"))).toEqual([
      "border-t",
      "border-border",
    ]);
  });
});

describe("Drawer — the name the root resolves to", () => {
  it("points at the trigger a titleless drawer was opened from, and drops the derived reference", async () => {
    const byRef = attrsOf(
      await render(
        <Drawer id='filters' labelledby='filters-trigger'>
          Body
        </Drawer>,
      ),
    );
    const byLabel = attrsOf(
      await render(
        <Drawer id='filters' label='Filters'>
          Body
        </Drawer>,
      ),
    );

    expect(byRef["aria-labelledby"]).toBe("filters-trigger");
    expect(byLabel["aria-labelledby"]).toBeUndefined();
    expect(byLabel["aria-label"]).toBe("Filters");
  });

  // A widened type is how the union is escaped in practice — a spread of a wider object, an `as`, or
  // a `.js` consumer — so the mechanism is asserted where the type is not the thing holding it.
  it("emits no reference at all when the caller asserted nothing, reached through a widened type", async () => {
    const widened = Drawer as unknown as (props: { id: string }) => JSXNode;
    const attrs = attrsOf(await render(widened({ id: "filters" })));

    expect(attrs).not.toHaveProperty("aria-labelledby");
    expect(attrs).not.toHaveProperty("aria-label");
  });

  // The dangling reference this replaces was reachable only by naming nothing, which the props union
  // now refuses — so the claim is the refusal, and `@ts-expect-error` fails the build if it lapses.
  it("cannot be rendered without a name, and the reference it does emit resolves to its own title", async () => {
    // @ts-expect-error — one of `label`, `labelledby` or `titled` is required.
    const unnamed = <Drawer id='filters'>Body</Drawer>;
    void unnamed;

    const html = await render(
      <Drawer id='filters' titled>
        <Drawer.Title for='filters'>Filters</Drawer.Title>
      </Drawer>,
    );
    const named = attrOf(html, "aria-labelledby", 'data-slot="drawer"');

    expect(named).toBe("filters-title");
    expect(tagOf(html, `id="${named}"`).startsWith("<h2 ")).toBe(true);
  });
});

describe("Drawer — a caller's aria-labelledby joins the derived name rather than replacing it", () => {
  it("lists the caller's id ahead of the title reference", async () => {
    expect(attrOf(await render(<Drawer id='nav' titled aria-labelledby='extra' />), "aria-labelledby", 'data-slot="drawer"')).toBe(
      "extra nav-title",
    );
  });

  it("lists an id once when the caller repeats the one they named the drawer by", async () => {
    expect(attrOf(await render(<Drawer id='nav' labelledby='t' aria-labelledby='t' />), "aria-labelledby", 'data-slot="drawer"')).toBe("t");
  });
});
