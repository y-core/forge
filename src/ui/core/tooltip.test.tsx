/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

/**
 * `core/Tooltip`'s SSR markup, pinned exactly.
 *
 * The subject here is `data-slot` as a **token list**: all three parts render their own literal token
 * before their `{...rest}` spread, so a token handed down by an outer compound — which arrives as an
 * ordinary prop — would replace theirs unless it is lifted out and composed via `slotToken`. The
 * bare-literal cases below are the regression guard for the other half of that property: composing
 * must change nothing for the overwhelming majority of call sites that inherit no token at all.
 */

const ROOT_CLASS = "relative inline-block";
const TRIGGER_CLASS = "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CONTENT_CLASS = "z-50 w-max max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md";
/**
 * The merged result of `Menu.Trigger`'s own class and `TRIGGER_CLASS`, spelled out whole. Both
 * declare `outline-none focus-visible:ring-2 focus-visible:ring-ring`, so `cn` drops the earlier
 * copy and keeps the later one in place — a repeated class name has no cascade effect. The menu
 * trigger's `cursor-pointer` is a genuine conflict and loses to the later `cursor-default`, which
 * leaves the merge byte-identical to `TRIGGER_CLASS`.
 */
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
    // `cloneAsChild` writes `data-slot` as the last key of its literal, so the caller's token has to
    // travel in the `slot` option rather than in the spread prop bag or it would be overwritten here.
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
    // Three independent sources for one attribute, and the order is the contract:
    //   1. the child element's own literal   — `inner`
    //   2. the compound's own literal        — `tooltip-trigger`
    //   3. the token the caller handed down  — `my-thing`
    // `cloneAsChild` computes `slotToken(childSlot, options.slot)`, and `options.slot` is itself
    // already `slotToken("tooltip-trigger", inherited)` — so the caller's token arrives pre-appended
    // to the compound's and the pair lands behind the child's, child-first, innermost-first.
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
    // The shape that actually occurs: the inner compound's token is not a plain prop on an intrinsic
    // element but one it emits itself, so the inherited token has to survive being injected into that
    // compound's props and re-emitted by it before `cloneAsChild` ever sees it.
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
          <Menu.Trigger id='file-menu'>File</Menu.Trigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger my-thing" command="toggle-popover" commandfor="file-menu" ' +
        `aria-haspopup="menu" class="${MENU_TRIGGER_WITH_TOOLTIP_CLASS}" aria-describedby="tip">File</button>`,
    );
  });
});

describe("Tooltip.Content — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Tooltip.Content id='tip'>Hint</Tooltip.Content>)).toBe(
      '<div id="tip" role="tooltip" data-slot="tooltip-content" popover="manual" data-closed="" data-side="top" data-align="center" ' +
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
      '<div id="tip" role="tooltip" data-slot="tooltip-content rail-tip-body" popover="manual" data-closed="" data-side="top" ' +
        `data-align="center" class="${CONTENT_CLASS}">Hint</div>`,
    );
  });
});

describe("Tooltip — a non-string inherited token contributes nothing", () => {
  // `data-*` props are typed `unknown`, so every one of these reaches `slotToken` at runtime. Each
  // must yield the bare literal — a stringified value would put `data-slot="tooltip-trigger 42"` in
  // the markup, and an empty one would leave a trailing space that breaks every exact-match golden.
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

    // Asserted as `{ label, html }` pairs rather than one `toBe` per row, so a failure names the input
    // that produced the wrong markup instead of only reporting that some row did.
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
      '<div id="tip" role="tooltip" data-slot="tooltip-content" popover="manual" data-closed="" data-side="top" data-align="center" ' +
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
