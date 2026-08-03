/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../../jsx/render-test-helper";
import { Toolbar } from "../toolbar";
import { cloneAsChild } from "./as-child";

const MESSAGE = "test compound with asChild requires exactly one JSX element child";

const base = { slot: "probe", class: "probe-class", props: {}, message: MESSAGE };

describe("cloneAsChild — button options the compound never set", () => {
  it("leaves a child button's own type alone when no type option is given", async () => {
    expect(await render(cloneAsChild(<button type='button'>Go</button>, base))).toBe(
      '<button type="button" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("leaves a child button's own disabled alone when no disabled option is given", async () => {
    // biome-ignore lint/a11y/useButtonType: a child that declares no type is the case under test
    const child = <button disabled>Go</button>;

    expect(await render(cloneAsChild(child, base))).toBe('<button disabled class="probe-class" data-slot="probe">Go</button>');
  });

  it("keeps type and disabled together on a child that declares both", async () => {
    expect(
      await render(
        cloneAsChild(
          <button type='reset' disabled>
            Go
          </button>,
          base,
        ),
      ),
    ).toBe('<button type="reset" disabled class="probe-class" data-slot="probe">Go</button>');
  });
});

describe("cloneAsChild — button options the compound did set", () => {
  it("an explicit type option overrides the child's own", async () => {
    expect(await render(cloneAsChild(<button type='button'>Go</button>, { ...base, type: "submit" }))).toBe(
      '<button type="submit" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("an explicit disabled option overrides the child's own", async () => {
    // biome-ignore lint/a11y/useButtonType: a child that declares no type is the case under test
    const child = <button>Go</button>;

    expect(await render(cloneAsChild(child, { ...base, disabled: true }))).toBe(
      '<button disabled class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("disabled=false is a decision, not an omission, and clears the child's own", async () => {
    // biome-ignore lint/a11y/useButtonType: a child that declares no type is the case under test
    const child = <button disabled>Go</button>;

    expect(await render(cloneAsChild(child, { ...base, disabled: false }))).toBe('<button class="probe-class" data-slot="probe">Go</button>');
  });
});

describe("cloneAsChild — non-button children", () => {
  it("an anchor gets the ARIA form of disabled and keeps its href", async () => {
    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, { ...base, disabled: true }))).toBe(
      '<a href="/docs" aria-disabled="true" data-disabled="" class="probe-class" data-slot="probe">Docs</a>',
    );
  });

  it("an anchor is never given a native type, even when the compound sets one", async () => {
    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, { ...base, type: "button" }))).toBe(
      '<a href="/docs" class="probe-class" data-slot="probe">Docs</a>',
    );
  });
});

describe("Toolbar.Link asChild — the compound that sets neither option", () => {
  it("does not turn a child button into a submit button", async () => {
    // `Toolbar.Link` passes no `type` and no `disabled`; spreading those as undefined used to erase
    // the child's own `type`, leaving a button that submits the surrounding form on click.
    expect(
      await render(
        <Toolbar.Link asChild>
          <button type='button'>Docs</button>
        </Toolbar.Link>,
      ),
    ).toBe(
      '<button type="button" data-toolbar-item="" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm underline-offset-4 hover:underline" data-slot="toolbar-link">Docs</button>',
    );
  });
});
