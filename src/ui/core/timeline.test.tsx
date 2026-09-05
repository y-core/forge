/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Timeline } from "./timeline";

const PRIMARY_VARS =
  "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] " +
  "[--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]";
const SUCCESS_VARS =
  "[--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] " +
  "[--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] " +
  "[--tone-soft-border:var(--color-status-success-border)]";

const H = "group-data-[orientation=horizontal]/timeline:";
const ITEM_CLASS = `group/timeline-item flex gap-3 ${H}flex-1 ${H}flex-col`;
const MARKER = "inline-flex size-control-sm items-center justify-center rounded-selector border-field text-sm font-medium";
const RULE = `w-px flex-1 border-0 bg-border group-last/timeline-item:hidden ${H}h-px ${H}w-auto`;
const BODY = `pb-6 group-last/timeline-item:pb-0 ${H}pe-6 ${H}pb-0`;

// The marker is `aria-hidden` and the three states differ only in colour, so each item carries a
// visually-hidden state word outside it. Keyed off the paint so no call site restates the state.
const STATE_WORD: Record<string, string> = {
  "border-transparent bg-(--tone) text-(--tone-fg)": "Completed",
  "border-(--tone-text) text-(--tone-text)": "Current",
  "border-border text-muted-foreground": "Not started",
};

function markerColumn(state: string, children = ""): string {
  return (
    `<span data-slot="timeline-marker" aria-hidden="true" class="flex flex-col items-center ${H}flex-row">` +
    `<span class="${MARKER} ${state}">${children}</span>` +
    `<span data-slot="timeline-rule" class="${RULE}"></span></span>` +
    `<span class="sr-only">${STATE_WORD[state]}</span>`
  );
}

function item(state: string, attrs: string, marker: string, body: string): string {
  return `<li data-slot="timeline-item" data-state="${state}" class="${ITEM_CLASS}"${attrs}>${markerColumn(marker)}<div data-slot="timeline-body" class="${BODY}">${body}</div></li>`;
}

describe("Timeline", () => {
  it("stacks the record down the block axis and hands every marker the primary tone", async () => {
    expect(await render(<Timeline />)).toBe(
      `<ol data-slot="timeline" data-orientation="vertical" class="${PRIMARY_VARS} group/timeline flex flex-col"></ol>`,
    );
  });

  it("lays a horizontal record along the inline axis and says so in the state attribute", async () => {
    expect(await render(<Timeline orientation='horizontal' />)).toBe(
      `<ol data-slot="timeline" data-orientation="horizontal" class="${PRIMARY_VARS} group/timeline flex"></ol>`,
    );
  });

  it("swaps the tone properties every marker inherits", async () => {
    expect(await render(<Timeline tone='success' />)).toBe(
      `<ol data-slot="timeline" data-orientation="vertical" class="${SUCCESS_VARS} group/timeline flex flex-col"></ol>`,
    );
  });

  it("merges a caller class and keeps its own slot token ahead of an inherited one", async () => {
    expect(await render(<Timeline class='p-2' data-slot='history' />)).toBe(
      `<ol data-slot="timeline history" data-orientation="vertical" class="${PRIMARY_VARS} group/timeline flex flex-col p-2"></ol>`,
    );
  });

  it("escapes a forwarded value and lets the caller override the state attribute", async () => {
    expect(await render(<Timeline data-note={`R&D's "n" <x>`} data-orientation='caller-wins' />)).toBe(
      `<ol data-slot="timeline" data-orientation="caller-wins" class="${PRIMARY_VARS} group/timeline flex flex-col" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></ol>`,
    );
  });
});

describe("Timeline.Item", () => {
  it("treats an item with no state as upcoming and hides its rule when it is last", async () => {
    expect(await render(<Timeline.Item />)).toBe(item("upcoming", "", "border-border text-muted-foreground", ""));
  });

  it("fills the marker of a complete item from the inherited tone", async () => {
    expect(await render(<Timeline.Item state='complete' marker='✓' />)).toBe(
      `<li data-slot="timeline-item" data-state="complete" class="${ITEM_CLASS}">` +
        markerColumn("border-transparent bg-(--tone) text-(--tone-fg)", "✓") +
        `<div data-slot="timeline-body" class="${BODY}"></div></li>`,
    );
  });

  it("outlines the current item and claims no ARIA current, since a record is not a wizard", async () => {
    expect(await render(<Timeline.Item state='current' marker='2' />)).toBe(
      `<li data-slot="timeline-item" data-state="current" class="${ITEM_CLASS}">` +
        markerColumn("border-(--tone-text) text-(--tone-text)", "2") +
        `<div data-slot="timeline-body" class="${BODY}"></div></li>`,
    );
  });

  it("merges a caller class and escapes a forwarded value", async () => {
    expect(await render(<Timeline.Item class='p-2' data-note={`R&D's "n" <x>`} />)).toBe(
      `<li data-slot="timeline-item" data-state="upcoming" class="${ITEM_CLASS} p-2" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">` +
        markerColumn("border-border text-muted-foreground") +
        `<div data-slot="timeline-body" class="${BODY}"></div></li>`,
    );
  });

  it("puts Time and Content in the body, in the order given", async () => {
    expect(
      await render(
        <Timeline.Item state='complete' marker='1'>
          <Timeline.Time datetime='2026-09-04'>4 Sep</Timeline.Time>
          <Timeline.Content>Shipped</Timeline.Content>
        </Timeline.Item>,
      ),
    ).toBe(
      item(
        "complete",
        "",
        "border-transparent bg-(--tone) text-(--tone-fg)",
        '<time data-slot="timeline-time" class="text-xs text-muted-foreground tabular-nums" datetime="2026-09-04">4 Sep</time>' +
          '<div data-slot="timeline-content" class="text-sm">Shipped</div>',
      ).replace(
        markerColumn("border-transparent bg-(--tone) text-(--tone-fg)"),
        markerColumn("border-transparent bg-(--tone) text-(--tone-fg)", "1"),
      ),
    );
  });
});

describe("Timeline.Time", () => {
  it("merges a caller class and escapes a forwarded value", async () => {
    expect(await render(<Timeline.Time class='font-medium' datetime={`R&D's "n" <x>`} />)).toBe(
      '<time data-slot="timeline-time" class="text-xs text-muted-foreground tabular-nums font-medium" datetime="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></time>',
    );
  });
});

describe("Timeline.Content", () => {
  it("merges a caller class and escapes a forwarded value", async () => {
    expect(await render(<Timeline.Content class='p-2' data-note={`R&D's "n" <x>`} />)).toBe(
      '<div data-slot="timeline-content" class="text-sm p-2" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></div>',
    );
  });
});

describe("Timeline — the whole record", () => {
  it("renders the three states under one tone declaration", async () => {
    expect(
      await render(
        <Timeline>
          <Timeline.Item state='complete' marker='1' />
          <Timeline.Item state='current' marker='2' />
          <Timeline.Item marker='3' />
        </Timeline>,
      ),
    ).toBe(
      `<ol data-slot="timeline" data-orientation="vertical" class="${PRIMARY_VARS} group/timeline flex flex-col">` +
        `<li data-slot="timeline-item" data-state="complete" class="${ITEM_CLASS}">${markerColumn("border-transparent bg-(--tone) text-(--tone-fg)", "1")}<div data-slot="timeline-body" class="${BODY}"></div></li>` +
        `<li data-slot="timeline-item" data-state="current" class="${ITEM_CLASS}">${markerColumn("border-(--tone-text) text-(--tone-text)", "2")}<div data-slot="timeline-body" class="${BODY}"></div></li>` +
        `<li data-slot="timeline-item" data-state="upcoming" class="${ITEM_CLASS}">${markerColumn("border-border text-muted-foreground", "3")}<div data-slot="timeline-body" class="${BODY}"></div></li>` +
        "</ol>",
    );
  });
});

// `forge-ui-not-color-alone`, without touching the documented no-`aria-current` decision: a record
// is not a wizard, so `current` stays visual — but completion must still reach a screen reader.
describe("Timeline.Item — completion is not colour alone", () => {
  it("names every state in a visually-hidden span, and still claims no aria-current", async () => {
    const rendered = await Promise.all((["complete", "current", "upcoming"] as const).map((state) => render(<Timeline.Item state={state} />)));

    expect(rendered.map((html) => html.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1])).toEqual(["Completed", "Current", "Not started"]);
    expect(rendered.filter((html) => html.includes("aria-current"))).toEqual([]);
  });
});
