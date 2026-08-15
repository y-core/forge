/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { CONTROLS_DEMO_SCOPE, CONTROLS_DEMO_STATE, type ControlsDemoState, controlsReadout } from "../contracts/controls-demo-contract";
import { fieldId } from "../core/field";
import { SECTIONS } from "./components";
import { ControlsDemos } from "./controls-demos";
import { DEMO_COVERAGE, sectionBodies } from "./coverage";

// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const html = await render(<ControlsDemos icon={icon} />);
const bodies = sectionBodies(html);

const body = (id: string): string => bodies.get(id) ?? "";
const tags = (source: string, pattern: RegExp): string[] => [...source.matchAll(pattern)].map((match) => match[0]);
const attr = (tag: string, name: string): string | null => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const boundTag = (field: string): string => tags(html, new RegExp(`<[a-z]+ [^>]*data-field="${field}"[^>]*>`, "g"))[0] ?? "";

const BOUND_FIELD: Record<string, keyof ControlsDemoState> = {
  "controls-input": "text",
  "controls-select": "unit",
  "controls-slider": "level",
  "controls-switch": "enabled",
  "controls-textarea": "notes",
  "controls-toggle-group": "align",
  "controls-toggle": "bold",
  "controls-number-field": "count",
  "controls-radio-group": "plan",
  "controls-checkbox-group": "toppings",
};

// Two per control, in render order: the default instance, then the second one in another state.
const READOUT_ORDER: (keyof ControlsDemoState)[] = [
  "mirror",
  "text",
  "email",
  "unit",
  "precision",
  "level",
  "zoom",
  "enabled",
  "notifications",
  "notes",
  "summary",
  "align",
  "weight",
  "bold",
  "count",
  "plan",
  "toppings",
];

const READOUT_CLASS = "text-sm tabular-nums text-muted-foreground";
const LABEL_CLASS = "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50";

describe("ControlsDemos", () => {
  it("stamps exactly one resumable scope carrying the whole band state", () => {
    const state = JSON.stringify(CONTROLS_DEMO_STATE).replaceAll('"', "&quot;");
    expect(tags(html, new RegExp(`<div data-scope="${CONTROLS_DEMO_SCOPE}"[^>]*>`, "g"))).toEqual([
      `<div data-scope="show-controls" data-state="${state}" class="space-y-10">`,
    ]);
  });

  it("binds each controls variant to its field by the pattern the coverage gate reads", () => {
    const unbound = DEMO_COVERAGE.filter((demo) => demo.barrel === "controls").flatMap((demo) =>
      demo.axes.flatMap(({ marker }) => {
        if (marker.kind !== "pattern") return [];
        const found = new RegExp(`${marker.source}${BOUND_FIELD[demo.section]}"`).test(body(demo.section));
        return found ? [] : [`${demo.section}: ${marker.source}`];
      }),
    );

    expect(unbound).toEqual([]);
    expect(Object.keys(BOUND_FIELD)).toHaveLength(10);
  });

  it("paints the text and slider controls from the shared state", () => {
    expect(
      [boundTag("text"), boundTag("level")].map((tag) => ({ slot: attr(tag, "data-slot"), value: attr(tag, "value"), id: attr(tag, "id") })),
    ).toEqual([
      { slot: "input", value: CONTROLS_DEMO_STATE.text, id: fieldId("text") },
      { slot: "slider", value: String(CONTROLS_DEMO_STATE.level), id: fieldId("level") },
    ]);
  });

  it("selects the state's unit and no other option", () => {
    expect(tags(body("controls-select"), /<option[^>]*>[^<]*<\/option>/g)).toEqual([
      '<option data-slot="select-option" value="mm" selected>Millimetres</option>',
      '<option data-slot="select-option" value="cm">Centimetres</option>',
      '<option data-slot="select-option" value="in">Inches</option>',
      '<option data-slot="select-option" value="mm">Millimetres</option>',
      '<option data-slot="select-option" value="in" selected>Inches</option>',
    ]);
  });

  it("checks the switch input the state enables", () => {
    expect(boundTag("enabled")).toBe(
      '<input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked data-field="enabled" id="field-enabled" name="enabled">',
    );
  });

  it("renders the notes as the textarea's own text", () => {
    expect(/<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(body("controls-textarea"))?.[1]).toBe(CONTROLS_DEMO_STATE.notes);
  });

  it("checks exactly the radio the state aligns to", () => {
    const items = tags(body("controls-toggle-group"), /<input[^>]*data-slot="toggle-group-input"[^>]*>/g);
    expect(items.map((item) => attr(item, "data-value"))).toEqual(["left", "center", "right", "regular", "medium", "bold"]);
    expect(items.filter((item) => item.includes(" checked")).map((item) => attr(item, "data-value"))).toEqual([
      CONTROLS_DEMO_STATE.align,
      CONTROLS_DEMO_STATE.weight,
    ]);
  });

  it("renders one readout per bound field, formatted by the contract", () => {
    expect(tags(html, /<output[^>]*>[^<]*<\/output>/g)).toEqual(
      READOUT_ORDER.map(
        (field) => `<output data-bind-text="${field}" class="${READOUT_CLASS}">${controlsReadout(CONTROLS_DEMO_STATE[field])}</output>`,
      ),
    );
  });

  it("points every standalone label at the control it names", () => {
    expect(tags(html, /<label data-slot="label"[^>]*>/g)).toEqual(
      ["native-name", "mirror", "text", "email", "unit", "precision", "level", "zoom", "notes", "summary", "count"].map(
        (field) => `<label data-slot="label" for="${fieldId(field)}" class="${LABEL_CLASS}">`,
      ),
    );
  });

  it("names the switch from the label wrapping it, with no separate one", () => {
    const switchBody = body("controls-switch");
    expect(tags(switchBody, /<label[^>]*>/g)).toEqual([
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" class="inline-flex items-center gap-2">',
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="before" class="inline-flex items-center gap-2 flex-row-reverse">',
    ]);
    expect(switchBody.indexOf('data-field="enabled"')).toBeGreaterThan(switchBody.indexOf("<label"));
    expect(switchBody.indexOf('data-field="enabled"')).toBeLessThan(switchBody.indexOf("</label>"));
  });

  it("names the toggle group from the group itself, never from a standalone label", () => {
    const groupBody = body("controls-toggle-group");

    // Each item is its own `<label>` wrapping a radio — that is what makes the group work with no
    // script. What must not appear is a *standalone* `Label`, which would name a control twice.
    expect(tags(groupBody, /<label data-slot="label"[^>]*>/g)).toEqual([]);
    expect(tags(groupBody, /<label data-slot="toggle-group-item"[^>]*>/g)).toHaveLength(6);
    expect(tags(groupBody, /<fieldset[^>]*>/g).map((tag) => attr(tag, "aria-label"))).toEqual(["Text alignment", "Font weight"]);
  });

  it("shows the same control twice, native beside bound", () => {
    const section = body("native-and-reactive");
    expect(tags(section, /<h3[^>]*>[^<]*<\/h3>/g)).toEqual([
      '<h3 class="text-sm font-semibold text-foreground">Native SSR</h3>',
      '<h3 class="text-sm font-semibold text-foreground">Bound</h3>',
    ]);
    expect(tags(section, /<input [^>]*data-slot="input"[^>]*>/g).map((tag) => attr(tag, "data-field"))).toEqual([null, "mirror"]);
  });

  it("lists every band section in the catalog under one group", () => {
    const bound = SECTIONS.filter((section) => section.group === "Bound Controls");
    expect(bound.map((section) => section.id)).toEqual([
      "native-and-reactive",
      "controls-input",
      "controls-select",
      "controls-slider",
      "controls-switch",
      "controls-textarea",
      "controls-toggle-group",
      "controls-toggle",
      "controls-number-field",
      "controls-radio-group",
      "controls-checkbox-group",
    ]);
    expect(bound.filter((section) => !bodies.has(section.id)).map((section) => section.id)).toEqual([]);
  });
});
