import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Button } from "./button";
import { createIcon } from "./icon";

const BOX =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors";
const PRIMARY =
  "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]";
const NEUTRAL =
  "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]";
const DESTRUCTIVE =
  "[--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)]";
const SOLID =
  "border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";
const LINK = "border-transparent bg-transparent text-(--tone-text) [--focus-ring:var(--color-ring)] underline-offset-4 hover:underline";

const MD = `${BOX} h-control-md px-4 text-sm ${PRIMARY} ${SOLID}`;

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 16 16" });

describe("Button", () => {
  it("renders primary solid at the md size by default", async () => {
    expect(await render(<Button>Click</Button>)).toBe(`<button type="button" data-slot="button" class="${MD}">Click</button>`);
  });

  it("renders neutral outline as the resting secondary chrome, border-input replacing the tone border", async () => {
    expect(
      await render(
        <Button tone='neutral' appearance='outline'>
          Click
        </Button>,
      ),
    ).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md px-4 text-sm ${NEUTRAL} bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground">Click</button>`,
    );
  });

  it("renders neutral ghost with the accent hover and no border", async () => {
    expect(
      await render(
        <Button tone='neutral' appearance='ghost'>
          Click
        </Button>,
      ),
    ).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md px-4 text-sm ${NEUTRAL} border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground">Click</button>`,
    );
  });

  it("renders a destructive tone through the same solid recipe", async () => {
    expect(await render(<Button tone='destructive'>Delete</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md px-4 text-sm ${DESTRUCTIVE} ${SOLID}">Delete</button>`,
    );
  });

  it("renders the link appearance as underlined tone text", async () => {
    expect(await render(<Button appearance='link'>Docs</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md px-4 text-sm ${PRIMARY} ${LINK}">Docs</button>`,
    );
  });

  it("sizes sm and lg from the control-height tokens", async () => {
    expect(await render(<Button size='sm'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-sm px-3 text-sm ${PRIMARY} ${SOLID}">Click</button>`,
    );
    expect(await render(<Button size='lg'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-lg px-6 text-base ${PRIMARY} ${SOLID}">Click</button>`,
    );
  });

  it("makes an icon shape a square of its size, at every size", async () => {
    expect(await render(<Button shape='icon'>x</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md text-sm w-control-md px-0 ${PRIMARY} ${SOLID}">x</button>`,
    );
    expect(
      await render(
        <Button shape='icon' size='sm'>
          x
        </Button>,
      ),
    ).toBe(`<button type="button" data-slot="button" class="${BOX} h-control-sm text-sm px-0 w-control-sm ${PRIMARY} ${SOLID}">x</button>`);
    expect(
      await render(
        <Button shape='icon' size='lg'>
          x
        </Button>,
      ),
    ).toBe(`<button type="button" data-slot="button" class="${BOX} h-control-lg text-base px-0 w-control-lg ${PRIMARY} ${SOLID}">x</button>`);
  });

  it("renders the square and circle shapes", async () => {
    expect(await render(<Button shape='square'>x</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md text-sm aspect-square w-full p-0 ${PRIMARY} ${SOLID}">x</button>`,
    );
    expect(await render(<Button shape='circle'>x</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX.replace(" rounded-field", "")} h-control-md text-sm w-control-md rounded-selector px-0 ${PRIMARY} ${SOLID}">x</button>`,
    );
  });

  it("defaults to type=button and passes type=submit and disabled through", async () => {
    expect(await render(<Button type='submit'>Click</Button>)).toBe(`<button type="submit" data-slot="button" class="${MD}">Click</button>`);
    expect(await render(<Button disabled>Click</Button>)).toBe(`<button type="button" data-slot="button" class="${MD}" disabled>Click</button>`);
  });

  it("stamps aria-busy and data-busy while loading, with no spinner unless an icon is given", async () => {
    expect(await render(<Button loading>Save</Button>)).toBe(
      `<button type="button" data-slot="button" class="${MD}" aria-busy="true" data-busy="">Save</button>`,
    );
  });

  it("renders a Spinner at its own size before the children when loading with an icon", async () => {
    expect(
      await render(
        <Button loading loadingIcon={icon} size='sm'>
          Save
        </Button>,
      ),
    ).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-sm px-3 text-sm ${PRIMARY} ${SOLID}" aria-busy="true" data-busy=""><span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 16 16" class="motion-safe:animate-spin size-4" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only motion-reduce:not-sr-only">Loading…</span></span>Save</button>`,
    );
  });

  it("merges a caller class after the recipe so it wins a conflict", async () => {
    expect(await render(<Button class='px-8'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BOX} h-control-md text-sm ${PRIMARY} ${SOLID} px-8">Click</button>`,
    );
  });

  it("forwards data-* and aria-* attributes with escaped values", async () => {
    expect(
      await render(
        <Button data-testid='b' aria-label='R&D'>
          Click
        </Button>,
      ),
    ).toBe(`<button type="button" data-slot="button" class="${MD}" data-testid="b" aria-label="R&amp;D">Click</button>`);
  });

  it("with asChild merges the recipe, busy hooks and slot onto the single element child", async () => {
    expect(
      await render(
        <Button asChild loading tone='neutral' appearance='ghost'>
          <a href='/docs'>Docs</a>
        </Button>,
      ),
    ).toBe(
      `<a href="/docs" aria-busy="true" data-busy="" class="${BOX} h-control-md px-4 text-sm ${NEUTRAL} border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-slot="button">Docs</a>`,
    );
  });

  it("with asChild and a loading spinner keeps every prop on the child and puts the spinner inside it", async () => {
    expect(
      await render(
        <Button asChild loading loadingIcon={icon} id='x'>
          <a href='/docs'>Docs</a>
        </Button>,
      ),
    ).toBe(
      `<a href="/docs" aria-busy="true" data-busy="" id="x" class="${BOX} h-control-md px-4 text-sm ${PRIMARY} ${SOLID}" data-slot="button"><span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 16 16" class="motion-safe:animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only motion-reduce:not-sr-only">Loading…</span></span>Docs</a>`,
    );
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

  // `type` used to default to `"button"` in the destructuring, so `options.type` was never
  // `undefined` and `cloneAsChild`'s not-set branch was unreachable: a child's `type="submit"` was
  // overwritten and the form it sat in stopped submitting.
  it("lets an asChild button child keep its own type when the caller states none", async () => {
    expect(
      await render(
        <Button asChild aria-label='Save'>
          <button type='submit'>Save</button>
        </Button>,
      ),
    ).toBe(
      '<button type="submit" aria-label="Save" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md px-4 text-sm [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]" data-slot="button">Save</button>',
    );
  });

  it("still stamps type=button on an asChild child that states none", async () => {
    expect(
      await render(
        <Button asChild aria-label='Go'>
          <button>Go</button>
        </Button>,
      ),
    ).toBe(
      '<button aria-label="Go" type="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md px-4 text-sm [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]" data-slot="button">Go</button>',
    );
  });

  it("lets the caller's own type win over the child's", async () => {
    expect(
      await render(
        <Button asChild type='reset'>
          <button type='submit'>Clear</button>
        </Button>,
      ),
    ).toBe(
      '<button type="reset" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md px-4 text-sm [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]" data-slot="button">Clear</button>',
    );
  });
});
