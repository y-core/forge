import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Button } from "./button";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 16 16" });

const SIZES = [
  { size: "sm", added: ["h-control-sm", "px-3"], dropped: ["h-control-md", "px-4"] },
  { size: "lg", added: ["h-control-lg", "px-6", "text-base"], dropped: ["h-control-md", "px-4", "text-sm"] },
] as const;

const ICON_SHAPES = [
  { size: "sm", added: ["px-0", "w-control-sm"], dropped: ["px-3"] },
  { size: "md", added: ["w-control-md", "px-0"], dropped: ["px-4"] },
  { size: "lg", added: ["px-0", "w-control-lg"], dropped: ["px-6"] },
] as const;

const childrenOf = (html: string): string => /^<(?:button|a)[^>]*>(.*)<\/(?:button|a)>$/s.exec(html)?.[1] ?? "";

describe("Button", () => {
  it("renders the whole default button exactly, forwarded attributes and children escaped", async () => {
    expect(await render(<Button data-testid='b' aria-label='R&D'>{`R&D's`}</Button>)).toBe(
      '<button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field' +
        " border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md px-4 text-sm" +
        " [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)]" +
        " [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)]" +
        " [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)]" +
        ' hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]" data-testid="b" aria-label="R&amp;D">R&amp;D&#39;s</button>',
    );
  });

  it("defaults to type=button, so a button inside a form does not submit it by accident", async () => {
    expect(attrsOf(await render(<Button>Click</Button>))).toEqual({ type: "button", "data-slot": "button" });
  });

  it("passes type=submit and disabled through to the element that acts on them", async () => {
    expect(attrsOf(await render(<Button type='submit'>Click</Button>))).toEqual({ type: "submit", "data-slot": "button" });
    expect(attrsOf(await render(<Button disabled>Click</Button>))).toEqual({ type: "button", "data-slot": "button", disabled: "" });
  });

  it("swaps the whole tone palette rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await render(<Button tone='destructive'>Delete</Button>), await render(<Button>Click</Button>));

    expect(added.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(dropped.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("gives the outline appearance the input border as its resting secondary chrome, and evicts the fill", async () => {
    expect(
      variantClasses(
        await render(
          <Button tone='neutral' appearance='outline'>
            Click
          </Button>,
        ),
        await render(<Button tone='neutral'>Click</Button>),
      ),
    ).toEqual({
      added: [
        "bg-transparent",
        "[--focus-ring:var(--color-ring)]",
        "border-input",
        "text-foreground",
        "hover:bg-accent",
        "hover:text-accent-foreground",
      ],
      dropped: [
        "border-transparent",
        "bg-(--tone)",
        "text-(--tone-fg)",
        "[--focus-ring:var(--tone-fg)]",
        "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
      ],
    });
  });

  it("gives the ghost appearance the accent hover and keeps its border transparent", async () => {
    expect(
      variantClasses(
        await render(
          <Button tone='neutral' appearance='ghost'>
            Click
          </Button>,
        ),
        await render(<Button tone='neutral'>Click</Button>),
      ),
    ).toEqual({
      added: ["bg-transparent", "[--focus-ring:var(--color-ring)]", "text-foreground", "hover:bg-accent", "hover:text-accent-foreground"],
      dropped: [
        "bg-(--tone)",
        "text-(--tone-fg)",
        "[--focus-ring:var(--tone-fg)]",
        "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
      ],
    });
  });

  it("renders the link appearance as underlined tone text with no fill of its own", async () => {
    expect(variantClasses(await render(<Button appearance='link'>Docs</Button>), await render(<Button>Click</Button>))).toEqual({
      added: ["bg-transparent", "text-(--tone-text)", "[--focus-ring:var(--color-ring)]", "underline-offset-4", "hover:underline"],
      dropped: [
        "bg-(--tone)",
        "text-(--tone-fg)",
        "[--focus-ring:var(--tone-fg)]",
        "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
      ],
    });
  });

  it("sizes from the control-height tokens, swapping the md default out rather than layering on it", async () => {
    const md = await render(<Button>Click</Button>);

    for (const { size, added, dropped } of SIZES) {
      expect(variantClasses(await render(<Button size={size}>Click</Button>), md)).toEqual({ added, dropped });
    }
  });

  it("makes an icon shape a square of its own size, trading the horizontal padding for a width", async () => {
    for (const { size, added, dropped } of ICON_SHAPES) {
      expect(
        variantClasses(
          await render(
            <Button shape='icon' size={size}>
              x
            </Button>,
          ),
          await render(<Button size={size}>x</Button>),
        ),
      ).toEqual({ added, dropped });
    }
  });

  it("stretches a square shape to its container and rounds a circle to a pill", async () => {
    const md = await render(<Button>x</Button>);

    expect(variantClasses(await render(<Button shape='square'>x</Button>), md)).toEqual({
      added: ["aspect-square", "w-full", "p-0"],
      dropped: ["px-4"],
    });
    expect(variantClasses(await render(<Button shape='circle'>x</Button>), md)).toEqual({
      added: ["w-control-md", "rounded-selector", "px-0"],
      dropped: ["rounded-field", "px-4"],
    });
  });

  // `state-busy` is `pointer-events-none`, which stops the mouse and not Enter — so a reader told only
  // "busy" could press again and dispatch a second submit while the first was in flight.
  it("marks a loading button unavailable as well as busy, keeping it focusable where it stands", async () => {
    const html = await render(<Button loading>Save</Button>);

    expect(attrsOf(html)).toEqual({ type: "button", "data-slot": "button", "aria-busy": "true", "aria-disabled": "true", "data-busy": "" });
    expect(childrenOf(html)).toBe("Save");
  });

  // The rule `menuItemAttrs` states: the platform runs `command` before any listener forge owns, so
  // a control that announces itself unavailable must not carry one at all.
  it("withholds the invoker while loading, the one activation route no sink can refuse", async () => {
    const loading = attrsOf(
      await render(
        <Button loading commandfor='confirm' command='show-modal'>
          Delete…
        </Button>,
      ),
    );

    expect(loading).not.toHaveProperty("command");
    expect(loading).not.toHaveProperty("commandfor");
    const idle = attrsOf(
      await render(
        <Button commandfor='confirm' command='show-modal'>
          Delete…
        </Button>,
      ),
    );

    expect({ command: idle.command, commandfor: idle.commandfor }).toEqual({ command: "show-modal", commandfor: "confirm" });
  });

  it("renders a Spinner at the button's own size before the children when loading with an icon", async () => {
    const html = await render(
      <Button loading loadingIcon={icon} size='sm'>
        Save
      </Button>,
    );

    expect(attrsOf(html, 'data-slot="spinner"')).toEqual({ "data-slot": "spinner" });
    expect(classesOf(html, 'data-slot="icon"')).toEqual(["motion-safe:animate-spin", "size-4"]);
    expect(childrenOf(html).endsWith("</span>Save")).toBe(true);
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Button class='px-8'>Click</Button>)).at(-1)).toBe("px-8");
  });

  it("with asChild merges the recipe, the busy hooks and the slot onto the single element child", async () => {
    const html = await render(
      <Button asChild loading tone='neutral' appearance='ghost'>
        <a href='/docs'>Docs</a>
      </Button>,
    );

    // The href goes with it: an anchor follows it on Enter whatever ARIA says, so a loading link that
    // kept one would navigate mid-request — the same rule `cloneAsChild` applies to a disabled anchor.
    expect(attrsOf(html)).toEqual({
      "aria-busy": "true",
      "aria-disabled": "true",
      "data-busy": "",
      role: "link",
      tabindex: "0",
      "data-slot": "button",
    });
    expect(classesOf(html)).toEqual(
      classesOf(
        await render(
          <Button tone='neutral' appearance='ghost'>
            Docs
          </Button>,
        ),
      ),
    );
  });

  it("with asChild and a loading spinner keeps every prop on the child and puts the spinner inside it", async () => {
    const html = await render(
      <Button asChild loading loadingIcon={icon} id='x'>
        <a href='/docs'>Docs</a>
      </Button>,
    );

    expect(attrsOf(html)).toEqual({
      "aria-busy": "true",
      "aria-disabled": "true",
      "data-busy": "",
      id: "x",
      role: "link",
      tabindex: "0",
      "data-slot": "button",
    });
    expect(classesOf(html, 'data-slot="icon"')).toEqual(["motion-safe:animate-spin", "size-6"]);
    expect(childrenOf(html).endsWith("</span>Docs")).toBe(true);
  });

  it("with asChild throws on anything but a single element child", async () => {
    await expect(render(<Button asChild>text</Button>)).rejects.toThrow("Button with asChild requires exactly one JSX element child");
    await expect(
      render(
        <Button asChild>
          <>
            <a href='/a'>a</a>
          </>
        </Button>,
      ),
    ).rejects.toThrow("Button with asChild requires exactly one JSX element child");
  });

  it("lets an asChild button child keep its own type when the caller states none", async () => {
    expect(
      attrsOf(
        await render(
          <Button asChild aria-label='Save'>
            <button type='submit'>Save</button>
          </Button>,
        ),
      ),
    ).toEqual({ type: "submit", "aria-label": "Save", "data-slot": "button" });
  });

  it("still stamps type=button on an asChild child that states none", async () => {
    expect(
      attrsOf(
        await render(
          <Button asChild aria-label='Go'>
            <button>Go</button>
          </Button>,
        ),
      ),
    ).toEqual({ "aria-label": "Go", type: "button", "data-slot": "button" });
  });

  it("lets the caller's own type win over the child's", async () => {
    expect(
      attrsOf(
        await render(
          <Button asChild type='reset'>
            <button type='submit'>Clear</button>
          </Button>,
        ),
      ),
    ).toEqual({ type: "reset", "data-slot": "button" });
  });
});
