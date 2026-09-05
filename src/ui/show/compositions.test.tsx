/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { CollectionSurface, CompositionsSection, FeedbackSurface, SettingsSurface } from "./compositions";

// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const icon = StubIcon as any;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const SKELETON_ROW = [
  '<div data-slot="skeleton" aria-hidden="true" class="rounded-field bg-muted motion-safe:animate-pulse h-4 w-3/4">',
  '<div data-slot="skeleton" aria-hidden="true" class="rounded-field bg-muted motion-safe:animate-pulse h-4 w-1/2">',
];

const attrsOf = (html: string, tag: string, attr: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, "g"))].map(([, value]) => value);

const openTagWithId = (html: string, id: string) => new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

const openTagsOfSlot = (html: string, slot: string) => [...html.matchAll(new RegExp(`<[a-z]+ data-slot="${slot}"[^>]*>`, "g"))].map(([tag]) => tag);

const textsOf = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>[^]*?([^<>]*)</${tag}>`, "g"))].map(([, text]) => text);

const slotText = (html: string, slot: string) => new RegExp(`data-slot="${slot}"[^>]*>([^<>]*)</`).exec(html)?.[1] ?? "";

const cardOf = (html: string, title: string) =>
  html.split('<div data-slot="card" ').find((chunk) => new RegExp(`<div data-slot="card-title"[^>]*>${title}</div>`).test(chunk)) ?? "";

const pinnedRows = (html: string) =>
  [...html.matchAll(/<td[^>]*>([^<>]*)<\/td><td[^>]*><span[^>]*>([^<>]*)<\/span><\/td>/g)].map(([, component, subpath]) => [component, subpath]);

describe("CompositionsSection", () => {
  it("renders the band anchor the table of contents links to", async () => {
    const out = await render(<CompositionsSection icon={icon} />);
    expect(attrsOf(out, "section", "id")).toEqual(["compositions", "composition-collection", "composition-form", "composition-feedback"]);
  });
});

describe("CollectionSurface", () => {
  it("renders the populated rows from forge's own components", async () => {
    const out = await render(<CollectionSurface />);
    expect(pinnedRows(cardOf(out, "Populated"))).toEqual([
      ["Alert", "ui/core"],
      ["FlashOob", "ui/server"],
      ["Skeleton", "ui/core"],
      ["Spinner", "ui/core"],
      ["Toast", "ui/core"],
    ]);
  });

  it("ships a designed empty state — a line of copy and the action that fills it", async () => {
    const empty = cardOf(await render(<CollectionSurface />), "Empty");
    expect(textsOf(empty, "p")).toEqual(["No components are pinned yet. Pin one from the catalog to start the list."]);
    expect(textsOf(empty, "button")).toEqual(["Pin a component"]);
  });

  it("shows the loading state as a skeleton in the row shape, never a spinner", async () => {
    const out = await render(<CollectionSurface />);
    expect(openTagsOfSlot(out, "skeleton")).toEqual([...Array(5)].flatMap(() => SKELETON_ROW));
    expect(openTagsOfSlot(out, "spinner")).toEqual([]);
  });

  it("names the failure in a destructive Alert and offers the way out", async () => {
    const out = await render(<CollectionSurface />);
    expect(occurrences(out, 'data-slot="alert" data-tone="destructive" data-appearance="soft"')).toBe(1);
    expect(occurrences(out, ">Could not load the component list</div>")).toBe(1);
    expect(occurrences(out, ">Retry</button>")).toBe(1);
  });
});

describe("SettingsSurface", () => {
  it("carries exactly one primary action, with a secondary beside it", async () => {
    const out = await render(<SettingsSurface icon={icon} />);
    const solidPrimary = [...out.matchAll(/<button[^>]*>/g)].filter(
      (tag) => tag[0].includes("[--tone:var(--color-primary)]") && tag[0].includes("bg-(--tone) text-(--tone-fg)"),
    );
    expect(solidPrimary.length).toBe(1);
    expect(textsOf(out, "button")).toEqual(["Reset", "Save settings"]);
  });

  it("wires each validated control through FormField rather than by hand", async () => {
    const out = await render(<SettingsSurface icon={icon} />);
    expect(attrsOf(out, "label", "for")).toEqual(["field-rows-per-page", "field-row-height"]);
    expect(openTagWithId(out, "field-rows-per-page")).toBe(
      '<select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" name="rows-per-page" id="field-rows-per-page" aria-describedby="field-rows-per-page-description">',
    );
    expect(openTagWithId(out, "field-row-height")).toBe(
      '<input data-slot="slider" type="range" data-size="md" class="state-disabled state-busy state-invalid w-full appearance-none rounded-full bg-transparent focus-ring cursor-pointer h-control-md text-sm max-w-xs" data-on-input="sync" name="row-height" min="32" max="64" step="4" value="40" id="field-row-height">',
    );
  });

  it("names the unvalidated settings row from the control itself", async () => {
    const out = await render(<SettingsSurface icon={icon} />);
    expect(openTagsOfSlot(out, "switch")).toEqual([
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid">',
    ]);
    expect(textsOf(out, "label")).toEqual(["Rows per page", "Row height", "Show subpath"]);
  });
});

describe("FeedbackSurface", () => {
  it("puts Alert and Toast side by side with the line that decides between them", async () => {
    const pair = cardOf(await render(<FeedbackSurface icon={icon} />), "Alert or Toast");
    expect(openTagsOfSlot(pair, "alert")).toEqual([
      '<div data-slot="alert" data-tone="warning" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 text-sm [--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] [--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]">',
    ]);
    expect(openTagsOfSlot(pair, "toast")).toEqual([
      '<div data-slot="toast" data-tone="success" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]">',
    ]);
    expect(slotText(pair, "card-description")).toBe(
      "The condition on the left is still true until someone dismisses it, so it stays. The one on the right already happened, so it announces itself and clears.",
    );
  });

  it("scopes the Spinner to the control in flight and the Skeleton to the known shape", async () => {
    const busy = cardOf(await render(<FeedbackSurface icon={icon} />), "Spinner or Skeleton");
    expect(openTagsOfSlot(busy, "spinner")).toEqual(['<span data-slot="spinner" role="status" class="inline-flex items-center justify-center">']);
    expect(openTagsOfSlot(busy, "skeleton")).toEqual([
      '<div data-slot="skeleton" aria-hidden="true" class="rounded-field bg-muted motion-safe:animate-pulse h-4 w-3/4">',
      '<div data-slot="skeleton" aria-hidden="true" class="rounded-field bg-muted motion-safe:animate-pulse h-4 w-full">',
    ]);
    expect(textsOf(busy, "button")).toEqual(["Saving…"]);
  });
});
