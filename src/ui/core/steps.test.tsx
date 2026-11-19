/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { escapeHtml } from "../../html/escape";
import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { stateAttrs } from "../contracts/state-attrs";
import { Steps } from "./steps";

const MARKER = 'data-slot="steps-marker"';
const labelOf = (html: string) => /<span data-slot="steps-label">([^<]*)</.exec(html)?.[1];

describe("Steps", () => {
  it("renders the whole trail exactly, a forwarded value escaped and the caller's state attribute winning", async () => {
    expect(await render(<Steps data-note={`R&D's "n" <x>`} data-orientation='caller-wins' />)).toBe(
      '<ol data-slot="steps" data-orientation="caller-wins" class="[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)]' +
        " [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)]" +
        ' [--tone-soft-border:var(--color-primary-soft-border)] flex gap-4" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></ol>',
    );
  });

  it("lays the trail out along the inline axis and says so in the state attribute", async () => {
    expect(attrsOf(await render(<Steps />))).toEqual({ "data-slot": "steps", "data-orientation": "horizontal" });
  });

  it("stacks a vertical trail along the other axis rather than laying a second one across it", async () => {
    const vertical = await render(<Steps orientation='vertical' />);

    expect(attrOf(vertical, "data-orientation")).toBe("vertical");
    expect(variantClasses(vertical, await render(<Steps />))).toEqual({ added: ["flex-col"], dropped: [] });
  });

  it("swaps the whole tone palette every step inherits rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await render(<Steps tone='success' />), await render(<Steps />));

    expect(added[0]).toBe("[--tone:var(--color-success)]");
    expect([...added, ...dropped].every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("appends a caller class after its own and keeps its slot token ahead of an inherited one", async () => {
    const html = await render(<Steps class='p-2' data-slot='wizard' />);

    expect(classesOf(html).at(-1)).toBe("p-2");
    expect(attrOf(html, "data-slot")).toBe("steps wizard");
  });
});

describe("Steps.Step", () => {
  it("treats a step with no state as upcoming and claims no ARIA current", async () => {
    const html = await render(<Steps.Step>One</Steps.Step>);

    expect(attrsOf(html)).toEqual({ "data-slot": "steps-step", "data-state": "upcoming" });
    expect(labelOf(html)).toBe("One");
  });

  it("renders one marker for every state, its tone keyed on the step's `data-state` so a state the client sets recolours it", async () => {
    const complete = await render(<Steps.Step state='complete' />);
    const current = await render(<Steps.Step state='current' />);
    const upcoming = await render(<Steps.Step />);

    expect([variantClasses(complete, upcoming, MARKER), variantClasses(current, upcoming, MARKER)]).toEqual([
      { added: [], dropped: [] },
      { added: [], dropped: [] },
    ]);
    // A variant binds the marker to its own item by child combinators, so the attribute carries them escaped.
    expect(classesOf(upcoming, MARKER).filter((token) => token.includes("data-state"))).toEqual(
      [
        "[:is([data-state=complete],[data-state=complete]>*)>&]:border-transparent",
        "[:is([data-state=complete],[data-state=complete]>*)>&]:bg-(--tone)",
        "[:is([data-state=complete],[data-state=complete]>*)>&]:text-(--tone-fg)",
        "[:is([data-state=current],[data-state=current]>*)>&]:border-(--tone-text)",
        "[:is([data-state=current],[data-state=current]>*)>&]:text-(--tone-text)",
      ].map(escapeHtml),
    );
  });

  it("announces the current step in ARIA, since that is where the reader is", async () => {
    expect(attrsOf(await render(<Steps.Step state='current' />))).toEqual({
      "data-slot": "steps-step",
      "data-state": "current",
      "aria-current": "step",
    });
  });

  it("shows the marker it was given inside the circle a screen reader is told to skip", async () => {
    const html = await render(<Steps.Step state='complete' marker='1' />);

    expect(/data-slot="steps-marker"[^>]*>([^<]*)</.exec(html)?.[1]).toBe("1");
    expect(attrOf(html, "aria-hidden", MARKER)).toBe("true");
  });

  it("escapes a forwarded value on the step", async () => {
    expect(attrsOf(await render(<Steps.Step data-note={`R&D's "n" <x>`}>One</Steps.Step>))).toEqual({
      "data-slot": "steps-step",
      "data-state": "upcoming",
      "data-note": "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;",
    });
  });

  it("emits every step state through the state-attribute builder", async () => {
    const states = ["complete", "current", "upcoming"] as const;
    const emitted = await Promise.all(states.map(async (state) => attrOf(await render(<Steps.Step state={state} />), "data-state")));

    expect(emitted).toEqual(states.map((state) => stateAttrs({ state })["data-state"]));
  });
});

describe("Steps — the whole trail", () => {
  it("renders the three states under one tone declaration", async () => {
    const html = await render(
      <Steps orientation='vertical' tone='success'>
        <Steps.Step state='complete' marker='1'>
          One
        </Steps.Step>
        <Steps.Step state='current' marker='2'>
          Two
        </Steps.Step>
        <Steps.Step marker='3'>Three</Steps.Step>
      </Steps>,
    );

    expect([...html.matchAll(/data-state="([^"]+)"/g)].map((match) => match[1])).toEqual(["complete", "current", "upcoming"]);
    expect([...html.matchAll(/<span data-slot="steps-label">([^<]*)</g)].map((match) => match[1])).toEqual(["One", "Two", "Three"]);
    expect(html.match(/\[--tone:/g)).toHaveLength(1);
  });
});

describe("Steps.Step — forge-ui-not-color-alone", () => {
  it("names every state in a visually-hidden span outside the marker a reader is told to skip", async () => {
    const words = await Promise.all(
      (["complete", "current", "upcoming"] as const).map(async (state) => {
        const html = await render(<Steps.Step state={state} />);
        return html.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1];
      }),
    );

    expect(words).toEqual(["Completed", "Current", "Not started"]);
  });
});

describe("Steps.Step — stateLabel", () => {
  it("replaces the shipped state word on the one step given it, leaving its siblings alone", async () => {
    const overridden = await render(<Steps.Step state='complete' stateLabel='Terminé' />);
    const shipped = await render(<Steps.Step state='complete' />);

    expect(/<span class="sr-only">([^<]*)<\/span>/.exec(overridden)?.[1]).toBe("Terminé");
    expect(/<span class="sr-only">([^<]*)<\/span>/.exec(shipped)?.[1]).toBe("Completed");
  });
});
