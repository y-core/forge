/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

const ROOT_CLASS = "relative inline-block";
const TRIGGER_CLASS = "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CONTENT_CLASS = "z-50 w-max max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md";
/** Byte-identical to `TRIGGER_CLASS` rather than duplicated by mistake: every class `Menu.Trigger` adds either repeats or loses to it. */
const MENU_TRIGGER_WITH_TOOLTIP_CLASS = "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";

describe("Tooltip — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Tooltip>x</Tooltip>)).toBe(`<div data-slot="tooltip" data-scope="tooltip" class="${ROOT_CLASS}">x</div>`);
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Tooltip data-slot='rail-tip'>x</Tooltip>)).toBe(
      `<div data-slot="tooltip rail-tip" data-scope="tooltip" class="${ROOT_CLASS}">x</div>`,
    );
  });
});

describe("Tooltip.Trigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Tooltip.Trigger for='tip'>Save</Tooltip.Trigger>)).toBe(
      `<button type="button" data-slot="tooltip-trigger" class="${TRIGGER_CLASS}" aria-describedby="tip">Save</button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' data-slot='my-thing'>
          Save
        </Tooltip.Trigger>,
      ),
    ).toBe(`<button type="button" data-slot="tooltip-trigger my-thing" class="${TRIGGER_CLASS}" aria-describedby="tip">Save</button>`);
  });

  it("composes the inherited token on the asChild path too", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
          <button type='button'>Save</button>
        </Tooltip.Trigger>,
      ),
    ).toBe(`<button type="button" aria-describedby="tip" class="${TRIGGER_CLASS}" data-slot="tooltip-trigger my-thing">Save</button>`);
  });
});

describe("Tooltip.Trigger asChild — the three-way token composition", () => {
  it("keeps the child's own token, the trigger's, and the inherited one", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
          <button type='button' data-slot='inner'>
            Save
          </button>
        </Tooltip.Trigger>,
      ),
    ).toBe(`<button type="button" data-slot="inner tooltip-trigger my-thing" aria-describedby="tip" class="${TRIGGER_CLASS}">Save</button>`);
  });

  it("does the same when the child is an unrendered compound rather than an intrinsic element", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
          <Menu.Trigger id='file-menu'>File</Menu.Trigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger my-thing" command="toggle-popover" commandfor="file-menu" ' +
        `aria-haspopup="menu" aria-controls="file-menu" aria-expanded="false" class="${MENU_TRIGGER_WITH_TOOLTIP_CLASS}" aria-describedby="tip">File</button>`,
    );
  });
});

describe("Tooltip.Content — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Tooltip.Content id='tip'>Hint</Tooltip.Content>)).toBe(
      '<div id="tip" role="tooltip" data-slot="tooltip-content" popover="hint" data-side="top" data-align="center" ' +
        `class="${CONTENT_CLASS}">Hint</div>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      await render(
        <Tooltip.Content id='tip' data-slot='rail-tip-body'>
          Hint
        </Tooltip.Content>,
      ),
    ).toBe(
      '<div id="tip" role="tooltip" data-slot="tooltip-content rail-tip-body" popover="hint" data-side="top" ' +
        `data-align="center" class="${CONTENT_CLASS}">Hint</div>`,
    );
  });
});

describe("Tooltip — a non-string inherited token contributes nothing", () => {
  const cases: Array<{ inherited: unknown; label: string }> = [
    { inherited: undefined, label: "undefined" },
    { inherited: "", label: "empty string" },
    { inherited: null, label: "null" },
    { inherited: 42, label: "a number" },
    { inherited: false, label: "false" },
    { inherited: {}, label: "an object" },
  ];

  it("renders the bare literal on the plain trigger for every non-string value", async () => {
    const bare = `<button type="button" data-slot="tooltip-trigger" class="${TRIGGER_CLASS}" aria-describedby="tip">Save</button>`;

    const actual = await Promise.all(
      cases.map(async ({ inherited, label }) => ({
        label,
        html: await render(
          <Tooltip.Trigger for='tip' data-slot={inherited}>
            Save
          </Tooltip.Trigger>,
        ),
      })),
    );

    expect(actual).toEqual(cases.map(({ label }) => ({ label, html: bare })));
  });

  it("renders the bare literal on the asChild trigger for every non-string value", async () => {
    const bare = `<button type="button" aria-describedby="tip" class="${TRIGGER_CLASS}" data-slot="tooltip-trigger">Save</button>`;

    const actual = await Promise.all(
      cases.map(async ({ inherited, label }) => ({
        label,
        html: await render(
          <Tooltip.Trigger for='tip' asChild data-slot={inherited}>
            <button type='button'>Save</button>
          </Tooltip.Trigger>,
        ),
      })),
    );

    expect(actual).toEqual(cases.map(({ label }) => ({ label, html: bare })));
  });

  it("renders the bare literal on the root and the content for every non-string value", async () => {
    const root = `<div data-slot="tooltip" data-scope="tooltip" class="${ROOT_CLASS}">x</div>`;
    const content =
      '<div id="tip" role="tooltip" data-slot="tooltip-content" popover="hint" data-side="top" data-align="center" ' +
      `class="${CONTENT_CLASS}">Hint</div>`;

    const actual = await Promise.all(
      cases.map(async ({ inherited, label }) => ({
        label,
        root: await render(<Tooltip data-slot={inherited}>x</Tooltip>),
        content: await render(
          <Tooltip.Content id='tip' data-slot={inherited}>
            Hint
          </Tooltip.Content>,
        ),
      })),
    );

    expect(actual).toEqual(cases.map(({ label }) => ({ label, root, content })));
  });
});
