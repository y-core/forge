/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Toolbar } from "./toolbar";

const defaultItem = () => render(<Toolbar.Button>Bold</Toolbar.Button>);

describe("Toolbar", () => {
  it("renders the root with the scope, the role and the orientation pair", async () => {
    expect(attrsOf(await render(<Toolbar>x</Toolbar>))).toEqual({
      role: "toolbar",
      "data-slot": "toolbar",
      "data-scope": "toolbar",
      "data-orientation": "horizontal",
      "aria-orientation": "horizontal",
    });
  });

  it("stacks a vertical toolbar and says so to both readers", async () => {
    const vertical = await render(<Toolbar orientation='vertical'>x</Toolbar>);

    expect(attrsOf(vertical)).toEqual({
      role: "toolbar",
      "data-slot": "toolbar",
      "data-scope": "toolbar",
      "data-orientation": "vertical",
      "aria-orientation": "vertical",
    });
    expect(variantClasses(vertical, await render(<Toolbar>x</Toolbar>))).toEqual({ added: ["flex-col"], dropped: [] });
  });
});

describe("Toolbar.Button", () => {
  it("renders the whole ghost item exactly at the small size, children escaped", async () => {
    expect(await render(<Toolbar.Button>{`R&D's`}</Toolbar.Button>)).toBe(
      '<button type="button" data-slot="toolbar-button" class="state-busy state-disabled inline-flex items-center justify-center gap-2' +
        " rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm" +
        " [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)]" +
        " [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]" +
        ' border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground"' +
        ' data-toolbar-item="">R&amp;D&#39;s</button>',
    );
  });

  it("omits the pressed pair entirely for a one-state item, and marks it as an item all the same", async () => {
    expect(attrsOf(await defaultItem())).toEqual({ type: "button", "data-slot": "toolbar-button", "data-toolbar-item": "" });
  });

  it("takes core/Button's variant and size, the outline border replacing the ghost one", async () => {
    expect(
      variantClasses(
        await render(
          <Toolbar.Button tone='neutral' appearance='outline' shape='icon'>
            B
          </Toolbar.Button>,
        ),
        await defaultItem(),
      ),
    ).toEqual({ added: ["px-0", "w-control-sm", "border-input"], dropped: ["px-3", "border-transparent"] });
  });

  it("sizes to its container with `square`", async () => {
    expect(variantClasses(await render(<Toolbar.Button shape='square'>B</Toolbar.Button>), await defaultItem())).toEqual({
      added: ["aspect-square", "w-full", "p-0"],
      dropped: ["px-3"],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Toolbar.Button class='my-item'>B</Toolbar.Button>)).at(-1)).toBe("my-item");
  });

  // Pressed is not the tab stop: several items may be pressed, and `composite.ts` takes the first
  // marked item and ignores the rest.
  it("stamps the pressed pair and claims no tab stop", async () => {
    expect(attrsOf(await render(<Toolbar.Button pressed>Bold</Toolbar.Button>))).toEqual({
      type: "button",
      "data-slot": "toolbar-button",
      "data-toolbar-item": "",
      "aria-pressed": "true",
      "data-pressed": "",
    });
  });

  it("lets the app mark the tab stop explicitly, on an item pressed or not", async () => {
    expect(attrsOf(await render(<Toolbar.Button data-composite-item-active=''>Save</Toolbar.Button>))).toEqual({
      type: "button",
      "data-slot": "toolbar-button",
      "data-toolbar-item": "",
      "data-composite-item-active": "",
    });
  });

  it("announces an explicitly unpressed item without claiming the tab stop", async () => {
    expect(attrsOf(await render(<Toolbar.Button pressed={false}>Bold</Toolbar.Button>))).toEqual({
      type: "button",
      "data-slot": "toolbar-button",
      "data-toolbar-item": "",
      "aria-pressed": "false",
    });
  });

  it("renders onto the caller's element with asChild, carrying the marks and the recipe with it", async () => {
    const html = await render(
      <Toolbar.Button asChild pressed>
        <a href='/x'>Go</a>
      </Toolbar.Button>,
    );

    expect(attrsOf(html)).toEqual({
      href: "/x",
      "data-toolbar-item": "",
      "aria-pressed": "true",
      "data-pressed": "",
      "data-slot": "toolbar-button",
    });
    expect(classesOf(html)).toEqual(classesOf(await defaultItem()));
  });

  // `disabled` arrives through `rest` here, so it landed on the `<a>` beside `aria-disabled` — an
  // attribute the platform ignores sitting next to the one that does the work.
  it("strips the native disabled attribute from a non-button asChild child", async () => {
    expect(
      attrsOf(
        await render(
          <Toolbar.Button asChild disabled>
            <a href='/x'>Go</a>
          </Toolbar.Button>,
        ),
      ),
    ).toEqual({ href: "/x", "data-toolbar-item": "", "aria-disabled": "true", "data-disabled": "", "data-slot": "toolbar-button" });
  });

  it("throws rather than degrading when asChild has no single element child", () => {
    expect(() => render(<Toolbar.Button asChild>text</Toolbar.Button>)).toThrow(/exactly one JSX element child/);
  });

  it("keeps its own slot token ahead of one handed down through props, on its own element or the caller's", async () => {
    expect(attrOf(await render(<Toolbar.Button data-slot='toolbar-action'>B</Toolbar.Button>), "data-slot")).toBe("toolbar-button toolbar-action");
    expect(
      attrOf(
        await render(
          <Toolbar.Button asChild data-slot='toolbar-action'>
            <a href='/x'>Go</a>
          </Toolbar.Button>,
        ),
        "data-slot",
      ),
    ).toBe("toolbar-button toolbar-action");
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(attrOf(await render(<Toolbar.Button data-slot=''>B</Toolbar.Button>), "data-slot")).toBe("toolbar-button");
  });
});

describe("Toolbar.Link", () => {
  it("shares the item base and adds its own underline affordance", async () => {
    const html = await render(<Toolbar.Link href='/docs'>Docs</Toolbar.Link>);

    expect(attrsOf(html)).toEqual({ "data-slot": "toolbar-link", "data-toolbar-item": "", href: "/docs" });
    expect(variantClasses(html, await defaultItem())).toEqual({ added: ["underline-offset-4", "hover:underline"], dropped: [] });
  });

  it("keeps its own slot token ahead of one handed down through props, on its own element or the caller's", async () => {
    expect(
      attrOf(
        await render(
          <Toolbar.Link href='/docs' data-slot='rail-tool'>
            Docs
          </Toolbar.Link>,
        ),
        "data-slot",
      ),
    ).toBe("toolbar-link rail-tool");
    expect(
      attrOf(
        await render(
          <Toolbar.Link asChild data-slot='rail-tool'>
            <button type='button'>Docs</button>
          </Toolbar.Link>,
        ),
        "data-slot",
      ),
    ).toBe("toolbar-link rail-tool");
  });
});

describe("Toolbar.Input", () => {
  it("is a focus stop like any other item", async () => {
    const html = await render(<Toolbar.Input placeholder='Search' />);

    expect(attrsOf(html)).toEqual({ "data-slot": "toolbar-input", "data-toolbar-item": "", placeholder: "Search" });
    expect(classesOf(html)).toEqual([
      "rounded-field",
      "border",
      "border-input",
      "bg-background",
      "px-2",
      "py-1",
      "text-sm",
      "text-foreground",
      "focus-ring",
      "placeholder:text-muted-foreground",
    ]);
  });
});

describe("Toolbar.Separator", () => {
  it("defaults to the axis across a horizontal toolbar", async () => {
    const html = await render(<Toolbar.Separator />);

    expect(attrsOf(html)).toEqual({ "data-slot": "toolbar-separator", "aria-orientation": "vertical" });
    expect(variantClasses(html, await render(<Toolbar.Separator orientation='horizontal' />))).toEqual({
      added: ["h-5", "w-px"],
      dropped: ["h-px", "w-full"],
    });
  });

  it("takes a caller class for the margins a rail needs", async () => {
    const html = await render(<Toolbar.Separator orientation='horizontal' class='my-1' />);

    expect(attrOf(html, "aria-orientation")).toBe("horizontal");
    expect(classesOf(html).at(-1)).toBe("my-1");
  });
});

describe("Toolbar — exactly one tab stop, whatever is pressed", () => {
  it("marks only the item the app marked, across two pressed siblings", async () => {
    const html = await render(
      <Toolbar>
        <Toolbar.Button pressed>Bold</Toolbar.Button>
        <Toolbar.Button pressed>Italic</Toolbar.Button>
        <Toolbar.Button data-composite-item-active=''>Save</Toolbar.Button>
      </Toolbar>,
    );

    const marked = [...html.matchAll(/<button[^>]*data-composite-item-active[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(marked).toEqual(["Save"]);
  });
});
