/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import type { FC, JSX } from "../../render/jsx/types";
import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Button } from "./button";
import { Link } from "./link";
import { Toolbar } from "./toolbar";

const defaultItem = () => render(<Toolbar.Button>Bold</Toolbar.Button>);

describe("Toolbar", () => {
  it("renders the root with the scope, the role and the orientation pair", async () => {
    expect(attrsOf(await render(<Toolbar label='Formatting'>x</Toolbar>))).toEqual({
      role: "toolbar",
      "aria-label": "Formatting",
      "data-slot": "toolbar",
      "data-scope": "toolbar",
      "data-orientation": "horizontal",
      "aria-orientation": "horizontal",
    });
  });

  it("stacks a vertical toolbar and says so to both readers", async () => {
    const vertical = await render(
      <Toolbar orientation='vertical' label='Formatting'>
        x
      </Toolbar>,
    );

    expect(attrsOf(vertical)).toEqual({
      role: "toolbar",
      "aria-label": "Formatting",
      "data-slot": "toolbar",
      "data-scope": "toolbar",
      "data-orientation": "vertical",
      "aria-orientation": "vertical",
    });
    expect(variantClasses(vertical, await render(<Toolbar label='Formatting'>x</Toolbar>))).toEqual({ added: ["flex-col"], dropped: [] });
  });
});

// `role="toolbar"` takes no name from its items, and a page may hold several rails — so the name is
// a required prop rather than an `aria-label` a caller may or may not remember to pass through.
describe("Toolbar — the name it must be given", () => {
  it("cannot be rendered unnamed, and takes a reference where there is a heading to point at", async () => {
    // @ts-expect-error — one of `label` or `labelledby` is required.
    const unnamed = <Toolbar>x</Toolbar>;
    void unnamed;

    expect(attrOf(await render(<Toolbar labelledby='editor-heading'>x</Toolbar>), "aria-labelledby")).toBe("editor-heading");
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

  it("strips both the native disabled attribute and the href from a non-button asChild child", async () => {
    expect(
      attrsOf(
        await render(
          <Toolbar.Button asChild disabled>
            <a href='/x'>Go</a>
          </Toolbar.Button>,
        ),
      ),
    ).toEqual({
      "data-toolbar-item": "",
      "aria-disabled": "true",
      "data-disabled": "",
      role: "link",
      tabindex: "0",
      "data-slot": "toolbar-button",
    });
  });

  it("models a caller's aria-disabled rather than passing it through unread", async () => {
    expect(attrsOf(await render(<Toolbar.Button aria-disabled='true'>Paste</Toolbar.Button>))).toEqual({
      type: "button",
      "data-toolbar-item": "",
      "aria-disabled": "true",
      "data-disabled": "",
      "data-slot": "toolbar-button",
    });
  });

  it("drops the href of an aria-disabled link, which the platform would follow regardless", async () => {
    expect(attrsOf(await render(<Toolbar.Link href='/x' aria-disabled='true' />))).toEqual({
      "data-toolbar-item": "",
      "aria-disabled": "true",
      "data-disabled": "",
      role: "link",
      tabindex: "0",
      "data-slot": "toolbar-link",
    });
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
      <Toolbar label='Formatting'>
        <Toolbar.Button pressed>Bold</Toolbar.Button>
        <Toolbar.Button pressed>Italic</Toolbar.Button>
        <Toolbar.Button data-composite-item-active=''>Save</Toolbar.Button>
      </Toolbar>,
    );

    const marked = [...html.matchAll(/<button[^>]*data-composite-item-active[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(marked).toEqual(["Save"]);
  });
});

const BareButton: FC<JSX.IntrinsicElements["button"]> = (props) => <button {...props} />;

describe("Toolbar.Button asChild — a component child's type", () => {
  it("keeps a Button child's own type='submit', so it still submits its form", async () => {
    expect(
      attrsOf(
        await render(
          <Toolbar.Button asChild>
            <Button type='submit'>Save</Button>
          </Toolbar.Button>,
        ),
      ),
    ).toEqual({ type: "submit", "data-slot": "button toolbar-button", "data-toolbar-item": "" });
  });

  it("gives type='button' to a component child that sets no type and renders none of its own", async () => {
    expect(
      attrsOf(
        await render(
          <Toolbar.Button asChild>
            <BareButton>Save</BareButton>
          </Toolbar.Button>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "toolbar-button", "data-toolbar-item": "" });
  });

  it("gives no type to a Link child, adding only its slot token and the roving-focus marker", async () => {
    const bare = attrsOf(await render(<Link href='/x'>Docs</Link>));

    expect(
      attrsOf(
        await render(
          <Toolbar.Button asChild>
            <Link href='/x'>Docs</Link>
          </Toolbar.Button>,
        ),
      ),
    ).toEqual({ ...bare, "data-slot": "link toolbar-button", "data-toolbar-item": "" });
  });
});

describe("Toolbar.Button asChild — an intrinsic button child's type", () => {
  it("keeps a child <button type='submit'> a submit button inside its form", async () => {
    const html = await render(
      <form>
        <Toolbar.Button asChild>
          <button type='submit'>Save</button>
        </Toolbar.Button>
      </form>,
    );

    expect(attrsOf(html, "data-toolbar-item")).toEqual({ type: "submit", "data-slot": "toolbar-button", "data-toolbar-item": "" });
  });

  it("lets the caller's own type override the child's", async () => {
    expect(
      attrsOf(
        await render(
          <Toolbar.Button type='submit' asChild>
            <button type='button'>Save</button>
          </Toolbar.Button>,
        ),
      ),
    ).toEqual({ type: "submit", "data-slot": "toolbar-button", "data-toolbar-item": "" });
  });
});
