/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import type { FC, JSX } from "../../render/jsx/types";
import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Link } from "./link";
import { Menu } from "./menu";
import { Toolbar } from "./toolbar";
import { Tooltip } from "./tooltip";

describe("Tooltip.Content", () => {
  it("renders the whole hint exactly, its own slot token alone and its children escaped", async () => {
    expect(await render(<Tooltip.Content id='tip'>{`R&D's <hint>`}</Tooltip.Content>)).toBe(
      '<span id="tip" role="tooltip" data-slot="tooltip-content" popover="hint" data-side="top" data-align="center" ' +
        'class="z-50 w-max max-w-xs rounded-field bg-foreground px-2 py-1 text-xs text-background shadow-md">R&amp;D&#39;s &lt;hint&gt;</span>',
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Content id='tip' data-slot='rail-tip-body'>
            Hint
          </Tooltip.Content>,
        ),
        "data-slot",
      ),
    ).toBe("tooltip-content rail-tip-body");
  });
});

describe("Tooltip", () => {
  it("carries the scope the controller resumes on, under its own slot token", async () => {
    expect(attrsOf(await render(<Tooltip>x</Tooltip>))).toEqual({ "data-slot": "tooltip", "data-scope": "tooltip" });
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Tooltip data-slot='rail-tip'>x</Tooltip>), "data-slot")).toBe("tooltip rail-tip");
  });
});

describe("Tooltip.Trigger", () => {
  it("is described by the content id when no kind is given", async () => {
    expect(attrsOf(await render(<Tooltip.Trigger for='tip'>Save</Tooltip.Trigger>))).toEqual({
      type: "button",
      "data-slot": "tooltip-trigger",
      "aria-describedby": "tip",
    });
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Trigger for='tip' data-slot='my-thing'>
            Save
          </Tooltip.Trigger>,
        ),
        "data-slot",
      ),
    ).toBe("tooltip-trigger my-thing");
  });

  it("composes the inherited token on the asChild path too, onto the caller's own element", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
            <button type='button'>Save</button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "aria-describedby": "tip", "data-slot": "tooltip-trigger my-thing" });
  });
});

describe("Tooltip.Trigger — the sm button box on the bare form", () => {
  it("clears the Floor bare, with the sm height, a focus ring and an unpainted border", async () => {
    const classes = classesOf(await render(<Tooltip.Trigger for='tip'>Save</Tooltip.Trigger>));

    for (const token of ["h-control-sm", "focus-ring", "border-transparent", "cursor-default"]) expect(classes).toContain(token);
  });

  it("lets a caller's padding evict the box's own while the height stays", async () => {
    const classes = classesOf(
      await render(
        <Tooltip.Trigger for='tip' class='px-6'>
          Save
        </Tooltip.Trigger>,
      ),
    );

    for (const token of ["px-6", "h-control-sm"]) expect(classes).toContain(token);
    expect(classes).not.toContain("px-3");
  });

  it("leaves the box to the child under asChild", async () => {
    const html = await render(
      <Tooltip.Trigger for='tip' asChild>
        <a href='/help'>Help</a>
      </Tooltip.Trigger>,
    );

    expect(classesOf(html)).not.toContain("h-control-sm");
  });
});

describe("Tooltip.Trigger asChild — the three-way token composition", () => {
  it("keeps the child's own token, the trigger's, and the inherited one", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
            <button type='button' data-slot='inner'>
              Save
            </button>
          </Tooltip.Trigger>,
        ),
        "data-slot",
      ),
    ).toBe("inner tooltip-trigger my-thing");
  });

  it("does the same when the child is an unrendered compound rather than an intrinsic element", async () => {
    const html = await render(
      <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
        <Menu.Trigger for='file-menu'>File</Menu.Trigger>
      </Tooltip.Trigger>,
    );

    expect(attrsOf(html)).toEqual({
      type: "button",
      "data-slot": "menu-trigger tooltip-trigger my-thing",
      command: "toggle-popover",
      commandfor: "file-menu",
      "aria-haspopup": "menu",
      "aria-controls": "file-menu",
      "aria-expanded": "false",
      "aria-describedby": "tip",
      id: "file-menu-trigger",
    });
  });

  it("leaves the trigger's own paint untouched, since every class the compound adds repeats or loses to it", async () => {
    expect(
      variantClasses(
        await render(
          <Tooltip.Trigger for='tip' asChild>
            <Menu.Trigger for='file-menu'>File</Menu.Trigger>
          </Tooltip.Trigger>,
        ),
        await render(<Tooltip.Trigger for='tip'>Save</Tooltip.Trigger>),
      ),
    ).toEqual({ added: [], dropped: [] });
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

  it("leaves every surface with its own bare token, whatever non-string it was handed", async () => {
    const actual = await Promise.all(
      cases.map(async ({ inherited, label }) => ({
        label,
        root: attrOf(await render(<Tooltip data-slot={inherited}>x</Tooltip>), "data-slot"),
        trigger: attrOf(
          await render(
            <Tooltip.Trigger for='tip' data-slot={inherited}>
              Save
            </Tooltip.Trigger>,
          ),
          "data-slot",
        ),
        asChild: attrOf(
          await render(
            <Tooltip.Trigger for='tip' asChild data-slot={inherited}>
              <button type='button'>Save</button>
            </Tooltip.Trigger>,
          ),
          "data-slot",
        ),
        content: attrOf(
          await render(
            <Tooltip.Content id='tip' data-slot={inherited}>
              Hint
            </Tooltip.Content>,
          ),
          "data-slot",
        ),
      })),
    );

    expect(actual).toEqual(
      cases.map(({ label }) => ({ label, root: "tooltip", trigger: "tooltip-trigger", asChild: "tooltip-trigger", content: "tooltip-content" })),
    );
  });
});

describe("Tooltip.Trigger kind — which ARIA reference the content id lands on", () => {
  const cases = [
    { kind: undefined, expected: { "aria-describedby": "tip" } },
    { kind: "description" as const, expected: { "aria-describedby": "tip" } },
    { kind: "label" as const, expected: { "aria-labelledby": "tip" } },
  ];

  it("labels by the content in label kind and describes by it otherwise, never both", async () => {
    const actual = await Promise.all(
      cases.map(async ({ kind }) => ({
        kind,
        own: attrsOf(
          await render(
            <Tooltip.Trigger for='tip' kind={kind}>
              B
            </Tooltip.Trigger>,
          ),
        ),
        asChild: attrsOf(
          await render(
            <Tooltip.Trigger for='tip' kind={kind} asChild>
              <button type='button'>B</button>
            </Tooltip.Trigger>,
          ),
        ),
      })),
    );

    expect(actual).toEqual(
      cases.map(({ kind, expected }) => ({
        kind,
        own: { type: "button", "data-slot": "tooltip-trigger", ...expected },
        asChild: { type: "button", "data-slot": "tooltip-trigger", ...expected },
      })),
    );
  });
});

describe("Tooltip.Trigger kind=label refuses a second name", () => {
  const cases = [
    {
      where: "its own props",
      prop: "aria-label",
      build: () => Tooltip.Trigger({ for: "tip", kind: "label", "aria-label": "Bold", children: "B" }),
    },
    {
      where: "its own props",
      prop: "aria-labelledby",
      build: () => Tooltip.Trigger({ for: "tip", kind: "label", "aria-labelledby": "other", children: "B" }),
    },
    {
      where: "the asChild child",
      prop: "aria-label",
      build: () =>
        Tooltip.Trigger({
          for: "tip",
          kind: "label",
          asChild: true,
          children: (
            <button type='button' aria-label='Bold'>
              B
            </button>
          ),
        }),
    },
    {
      where: "the asChild child",
      prop: "aria-labelledby",
      build: () =>
        Tooltip.Trigger({
          for: "tip",
          kind: "label",
          asChild: true,
          children: (
            <button type='button' aria-labelledby='other'>
              B
            </button>
          ),
        }),
    },
  ];

  for (const { where, prop, build } of cases) {
    it(`throws naming ${prop} when it is on ${where}`, () => {
      expect(build).toThrow(new RegExp(`kind="label" cannot also carry ${prop}:`));
    });
  }

  it("keeps an aria-label in description kind, where the tooltip only describes", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' aria-label='Bold'>
            B
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-describedby": "tip", "aria-label": "Bold" });
  });

  it("treats an aria-label set to undefined as no name at all", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' kind='label' aria-label={undefined}>
            B
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-labelledby": "tip" });
  });
});

describe("Tooltip.Trigger disabled — inert but still hoverable and focusable", () => {
  it("renders aria-disabled and data-disabled in place of the native disabled", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' disabled>
          Save
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="tooltip-trigger" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm border-transparent cursor-default" aria-describedby="tip" aria-disabled="true" data-disabled="">Save</button>',
    );
  });

  it("renders nothing inert for disabled={false}", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' disabled={false}>
            Save
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-describedby": "tip" });
  });

  it("converts an asChild button child's own disabled the same way", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' asChild>
            <button type='button' disabled>
              Save
            </button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-describedby": "tip", "aria-disabled": "true", "data-disabled": "" });
  });

  it("keeps a disabled Toolbar.Button child inert as aria-disabled, never native disabled", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' asChild>
            <Toolbar.Button disabled>B</Toolbar.Button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({
      type: "button",
      "data-slot": "toolbar-button tooltip-trigger",
      "data-toolbar-item": "",
      "aria-describedby": "tip",
      "aria-disabled": "true",
      "data-disabled": "",
    });
  });
});

const BareButton: FC<JSX.IntrinsicElements["button"]> = (props) => <button {...props} />;

describe("Tooltip.Trigger asChild — a component child's type", () => {
  it("keeps a Toolbar.Button child's own type='submit', so it still submits its form", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='t' asChild>
            <Toolbar.Button type='submit'>Save</Toolbar.Button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "submit", "data-slot": "toolbar-button tooltip-trigger", "data-toolbar-item": "", "aria-describedby": "t" });
  });

  it("gives no type to a component child that sets none, since it cannot see what the child renders", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='t' asChild>
            <BareButton>Save</BareButton>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ "data-slot": "tooltip-trigger", "aria-describedby": "t" });
  });

  it("gives no type to a Link child, adding only its slot token and aria-describedby", async () => {
    const bare = attrsOf(await render(<Link href='/x'>Docs</Link>));

    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='t' asChild>
            <Link href='/x'>Docs</Link>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ ...bare, "data-slot": "link tooltip-trigger", "aria-describedby": "t" });
  });
});

describe("Tooltip.Trigger asChild — an intrinsic button child's type", () => {
  it("keeps a child <button type='submit'> a submit button inside its form", async () => {
    const html = await render(
      <form>
        <Tooltip.Trigger for='t' asChild>
          <button type='submit'>Save</button>
        </Tooltip.Trigger>
      </form>,
    );

    expect(attrsOf(html, "aria-describedby")).toEqual({ type: "submit", "data-slot": "tooltip-trigger", "aria-describedby": "t" });
  });

  it("lets the caller's own type override the child's", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='t' type='submit' asChild>
            <button type='button'>Save</button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "submit", "data-slot": "tooltip-trigger", "aria-describedby": "t" });
  });
});

describe("Tooltip.Trigger — a caller's aria-describedby joins the content id rather than replacing it", () => {
  it("lists the caller's id ahead of the content id on a plain trigger", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' aria-describedby='hint'>
            Save
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-describedby": "hint tip" });
  });

  it("keeps the asChild child's own id ahead of the content id", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' asChild>
            <button type='button' aria-describedby='hint'>
              Save
            </button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-describedby": "hint tip" });
  });

  it("orders the child's id, then the trigger's, then the content id on the asChild path", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Trigger for='tip' asChild aria-describedby='a'>
            <button type='button' aria-describedby='b'>
              Save
            </button>
          </Tooltip.Trigger>,
        ),
        "aria-describedby",
      ),
    ).toBe("b a tip");
  });

  it("names the content id once and collapses the caller's whitespace", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Trigger for='tip' aria-describedby='  hint  tip '>
            Save
          </Tooltip.Trigger>,
        ),
        "aria-describedby",
      ),
    ).toBe("hint tip");
  });

  it("keeps the caller's description in label kind without describing the trigger by the content it is named by", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' kind='label' aria-describedby='hint'>
            B
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "data-slot": "tooltip-trigger", "aria-labelledby": "tip", "aria-describedby": "hint" });
  });

  it("drops a blank caller description in label kind, and reduces it to the content id otherwise", async () => {
    const rendered = async (kind: "label" | undefined) =>
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' kind={kind} aria-describedby='  '>
            B
          </Tooltip.Trigger>,
        ),
      );

    expect({ label: await rendered("label"), description: await rendered(undefined) }).toEqual({
      label: { type: "button", "data-slot": "tooltip-trigger", "aria-labelledby": "tip" },
      description: { type: "button", "data-slot": "tooltip-trigger", "aria-describedby": "tip" },
    });
  });
});

describe("Tooltip — phrasing content", () => {
  it("renders its root and its content as spans, so neither splits an enclosing paragraph", async () => {
    expect(await render(<Tooltip>x</Tooltip>)).toStartWith("<span");
    expect(await render(<Tooltip.Content id='tip'>Hint</Tooltip.Content>)).toStartWith("<span");
  });
});
