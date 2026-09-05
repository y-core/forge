/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Steps } from "./steps";

const PRIMARY_VARS =
  "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] " +
  "[--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]";
const SUCCESS_VARS =
  "[--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] " +
  "[--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] " +
  "[--tone-soft-border:var(--color-status-success-border)]";

const MARKER = "inline-flex size-control-sm items-center justify-center rounded-selector border-field text-sm font-medium";
const STEP_CLASS = "flex items-center gap-2";

// The marker is `aria-hidden` and the three states differ only in colour, so each step carries a
// visually-hidden state word beside it. Keyed off the paint so no call site restates the state.
const STATE_WORD: Record<string, string> = {
  "border-transparent bg-(--tone) text-(--tone-fg)": "Completed",
  "border-(--tone-text) text-(--tone-text)": "Current",
  "border-border text-muted-foreground": "Not started",
};

function marker(state: string, children = ""): string {
  return (
    `<span data-slot="steps-marker" aria-hidden="true" class="${MARKER} ${state}">${children}</span>` +
    `<span class="sr-only">${STATE_WORD[state]}</span>`
  );
}

describe("Steps", () => {
  it("lays the trail out along the inline axis and hands every step the primary tone", async () => {
    expect(await render(<Steps />)).toBe(`<ol data-slot="steps" data-orientation="horizontal" class="${PRIMARY_VARS} flex gap-4"></ol>`);
  });

  it("stacks a vertical trail along the other axis and says so in the state attribute", async () => {
    expect(await render(<Steps orientation='vertical' />)).toBe(
      `<ol data-slot="steps" data-orientation="vertical" class="${PRIMARY_VARS} flex flex-col gap-4"></ol>`,
    );
  });

  it("swaps the tone properties every step inherits", async () => {
    expect(await render(<Steps tone='success' />)).toBe(
      `<ol data-slot="steps" data-orientation="horizontal" class="${SUCCESS_VARS} flex gap-4"></ol>`,
    );
  });

  it("merges a caller class and keeps its own slot token ahead of an inherited one", async () => {
    expect(await render(<Steps class='p-2' data-slot='wizard' />)).toBe(
      `<ol data-slot="steps wizard" data-orientation="horizontal" class="${PRIMARY_VARS} flex gap-4 p-2"></ol>`,
    );
  });

  it("escapes a forwarded value and lets the caller override the state attribute", async () => {
    expect(await render(<Steps data-note={`R&D's "n" <x>`} data-orientation='caller-wins' />)).toBe(
      `<ol data-slot="steps" data-orientation="caller-wins" class="${PRIMARY_VARS} flex gap-4" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></ol>`,
    );
  });
});

describe("Steps.Step", () => {
  it("treats a step with no state as upcoming and claims no ARIA current", async () => {
    expect(await render(<Steps.Step>One</Steps.Step>)).toBe(
      `<li data-slot="steps-step" data-state="upcoming" class="${STEP_CLASS}">` +
        marker("border-border text-muted-foreground") +
        '<span data-slot="steps-label">One</span></li>',
    );
  });

  it("fills the marker of a complete step from the inherited tone", async () => {
    expect(
      await render(
        <Steps.Step state='complete' marker='1'>
          One
        </Steps.Step>,
      ),
    ).toBe(
      `<li data-slot="steps-step" data-state="complete" class="${STEP_CLASS}">` +
        marker("border-transparent bg-(--tone) text-(--tone-fg)", "1") +
        '<span data-slot="steps-label">One</span></li>',
    );
  });

  it("outlines the current step and announces it in ARIA", async () => {
    expect(
      await render(
        <Steps.Step state='current' marker='2'>
          Two
        </Steps.Step>,
      ),
    ).toBe(
      `<li data-slot="steps-step" data-state="current" aria-current="step" class="${STEP_CLASS}">` +
        marker("border-(--tone-text) text-(--tone-text)", "2") +
        '<span data-slot="steps-label">Two</span></li>',
    );
  });

  it("escapes a forwarded value on the step", async () => {
    expect(await render(<Steps.Step data-note={`R&D's "n" <x>`}>One</Steps.Step>)).toBe(
      `<li data-slot="steps-step" data-state="upcoming" class="${STEP_CLASS}" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">` +
        marker("border-border text-muted-foreground") +
        '<span data-slot="steps-label">One</span></li>',
    );
  });
});

describe("Steps — the whole trail", () => {
  it("renders the three states under one tone declaration", async () => {
    expect(
      await render(
        <Steps orientation='vertical' tone='success'>
          <Steps.Step state='complete' marker='1'>
            One
          </Steps.Step>
          <Steps.Step state='current' marker='2'>
            Two
          </Steps.Step>
          <Steps.Step marker='3'>Three</Steps.Step>
        </Steps>,
      ),
    ).toBe(
      `<ol data-slot="steps" data-orientation="vertical" class="${SUCCESS_VARS} flex flex-col gap-4">` +
        `<li data-slot="steps-step" data-state="complete" class="${STEP_CLASS}">` +
        marker("border-transparent bg-(--tone) text-(--tone-fg)", "1") +
        '<span data-slot="steps-label">One</span></li>' +
        `<li data-slot="steps-step" data-state="current" aria-current="step" class="${STEP_CLASS}">` +
        marker("border-(--tone-text) text-(--tone-text)", "2") +
        '<span data-slot="steps-label">Two</span></li>' +
        `<li data-slot="steps-step" data-state="upcoming" class="${STEP_CLASS}">` +
        marker("border-border text-muted-foreground", "3") +
        '<span data-slot="steps-label">Three</span></li>' +
        "</ol>",
    );
  });
});

// `forge-ui-not-color-alone`: the marker is the only visual difference between the three states, and
// it is `aria-hidden`. `aria-current` marks where the reader *is*, never what is finished.
describe("Steps.Step — completion is not colour alone", () => {
  it("names every state in a visually-hidden span outside the hidden marker", async () => {
    const words = await Promise.all(
      (["complete", "current", "upcoming"] as const).map(async (state) => {
        const html = await render(<Steps.Step state={state} />);
        return html.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1];
      }),
    );

    expect(words).toEqual(["Completed", "Current", "Not started"]);
  });
});
