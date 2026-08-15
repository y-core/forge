/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import type { FC } from "../../jsx/types";
import { render } from "../../testing/render";
import { STATE_ATTRS } from "../contracts/state-attrs";
import { createIcon } from "./icon";
import * as core from "./mod";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-spinner": "0 0 16 16" });

/** Deliberately ugly: every character in TESTING.md §3a's encoding map that is legal in an attribute value. */
const PROBE_RAW = `R&D's "n" <x>`;
const PROBE_ESCAPED = "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;";
const LABEL_RAW = `R&D's`;
const LABEL_ESCAPED = "R&amp;D&#39;s";

/** A padding utility no component uses, in a conflict group several components do use. */
const CALLER_CLASS = "p-99";

/** A state-attribute value no component can compute. */
const STATE_OVERRIDE = "caller-wins";

interface Participant {
  /** Fixture props for a component that cannot render without them. */
  readonly props?: Record<string, unknown>;
  /** The first `data-slot` token on the element that receives forwarded props. */
  readonly slot: string;
  /** The first `data-slot` token on the element that receives the caller's `class`, when it differs. */
  readonly classSlot?: string;
  /** The state attribute this component stamps onto the element that receives caller props. */
  readonly stateAttr?: string;
  /** The reason this component is excluded from the forwarding and `data-slot` contracts. */
  readonly noForward?: string;
}

const PARTICIPANTS: Record<string, Participant> = {
  Accordion: { slot: "accordion" },
  Alert: { slot: "alert" },
  Avatar: { slot: "avatar" },
  Badge: { slot: "badge" },
  Button: { slot: "button" },
  Card: { slot: "card" },
  CheckboxGroup: { props: { name: "cg" }, slot: "checkbox-group", stateAttr: "data-orientation" },
  Collapsible: { slot: "collapsible" },
  Dialog: { props: { id: "d1" }, slot: "dialog" },
  Field: { props: { label: "L" }, slot: "field", stateAttr: "data-orientation" },
  Form: { slot: "form" },
  FormField: { props: { name: "ff" }, slot: "field", stateAttr: "data-orientation" },
  Honeypot: { slot: "", noForward: "closed by design — a honeypot must not be addressable" },
  Icon: { props: { symbol: "x" }, slot: "icon", noForward: "closed prop list — see IconProps" },
  Input: { slot: "input" },
  Label: { slot: "label" },
  Menu: { slot: "menu" },
  Meter: { slot: "meter" },
  NumberField: { slot: "number-field" },
  Popover: { slot: "popover" },
  Progress: { slot: "progress", stateAttr: "data-orientation" },
  RadioGroup: { props: { name: "rg" }, slot: "radio-group", stateAttr: "data-orientation" },
  ScrollArea: { slot: "scroll-area", stateAttr: "data-orientation" },
  Select: { props: { icon }, slot: "select", classSlot: "select-wrapper" },
  Separator: { slot: "separator" },
  Skeleton: { slot: "skeleton" },
  Slider: { slot: "slider" },
  Spinner: { props: { icon }, slot: "spinner" },
  Switch: { slot: "switch-input", classSlot: "switch" },
  Tabs: { slot: "tabs", stateAttr: "data-orientation" },
  Textarea: { slot: "textarea" },
  Toast: { slot: "toast" },
  // Same shape as `Switch`: props reach the native input, the caller's class dresses the label.
  // No `stateAttr` — the checkbox's own `:checked` is the state, so there is none to stamp.
  Toggle: { slot: "toggle-input", classSlot: "toggle" },
  ToggleGroup: { slot: "toggle-group", stateAttr: "data-orientation" },
  Toolbar: { slot: "toolbar", stateAttr: "data-orientation" },
  Tooltip: { slot: "tooltip" },
  Turnstile: { props: { siteKey: "sk" }, slot: "turnstile" },
};

/** Every uppercase-initial function the barrel publishes — the components, and nothing else. */
function barrelComponentNames(): string[] {
  return Object.keys(core)
    .filter((key) => /^[A-Z]/.test(key))
    .filter((key) => typeof (core as Record<string, unknown>)[key] === "function")
    .sort();
}

/** An open tag's attributes, by name. */
function openTags(html: string): { readonly tag: string; readonly attrs: Record<string, string> }[] {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)((?:\s[^<>]*)?)\/?>/g)].map((match) => {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) {
      attrs[attr[1] as string] = attr[2] ?? "";
    }
    return { tag: match[1] as string, attrs };
  });
}

/** The element whose first `data-slot` token is `slot` — the component's own token. */
function elementBySlot(html: string, slot: string): Record<string, string> | undefined {
  return openTags(html).find((el) => (el.attrs["data-slot"] ?? "").split(" ")[0] === slot)?.attrs;
}

async function renderProbe(name: string, participant: Participant, extra: Record<string, unknown> = {}): Promise<string> {
  const Component = (core as Record<string, unknown>)[name] as FC<Record<string, unknown>>;
  return await render(
    <Component
      {...(participant.props ?? {})}
      data-probe={PROBE_RAW}
      aria-label={LABEL_RAW}
      style='color:red'
      class={CALLER_CLASS}
      data-slot='inherited'
      {...extra}>
      kid
    </Component>,
  );
}

const NAMES = barrelComponentNames();
const FORWARDING = NAMES.filter((name) => !PARTICIPANTS[name]?.noForward);

/** One rendered probe per component, reused by every contract below. */
const RENDERED: Record<string, string> = {};
for (const name of NAMES) {
  const participant = PARTICIPANTS[name];
  if (participant) RENDERED[name] = await renderProbe(name, participant);
}

const STATE_ATTR_NAMES = new Set<string>(Object.values(STATE_ATTRS));

/** Which state attribute each component computes on the element that receives caller props, read off the baseline probe. */
function computedStateAttrs(name: string): string {
  const el = elementBySlot(RENDERED[name] ?? "", PARTICIPANTS[name]?.slot ?? "");
  return Object.keys(el ?? {})
    .filter((attr) => STATE_ATTR_NAMES.has(attr))
    .sort()
    .join(" ");
}

const COMPUTED_STATE: Record<string, string> = Object.fromEntries(
  NAMES.map((name) => [name, computedStateAttrs(name)] as const).filter(([, attrs]) => attrs !== ""),
);

/** What `PARTICIPANTS` claims, in the shape `COMPUTED_STATE` is derived in. */
const STATE_PARTICIPANTS: Record<string, string> = Object.fromEntries(
  Object.entries(PARTICIPANTS)
    .map(([name, participant]) => [name, participant.stateAttr] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
);

/** A second probe per stateful component, this one also passing the component's own state attribute explicitly. */
const OVERRIDDEN: Record<string, string> = {};
for (const [name, attr] of Object.entries(STATE_PARTICIPANTS)) {
  OVERRIDDEN[name] = await renderProbe(name, PARTICIPANTS[name] as Participant, { [attr]: STATE_OVERRIDE });
}

/** The table every contract is compared against, so a diff names the offending component. */
function expected(names: string[], value: string): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, value]));
}

describe("ui/core conformance — the sweep is derived from the barrel", () => {
  it("declares a participation entry for every component the barrel exports", () => {
    expect(Object.keys(PARTICIPANTS).sort()).toEqual(NAMES);
  });

  it("sweeps a meaningful number of components", () => {
    expect(NAMES.length).toBeGreaterThan(30);
  });

  it("declares every component that stamps a state attribute onto its forwarding element", () => {
    expect(COMPUTED_STATE).toEqual(STATE_PARTICIPANTS);
  });
});

describe("ui/core conformance — the five contracts", () => {
  it("forwards arbitrary data-* and aria-* props to the target element, HTML-escaped", () => {
    expect(
      Object.fromEntries(
        FORWARDING.map((name) => {
          const el = elementBySlot(RENDERED[name] as string, PARTICIPANTS[name]?.slot as string);
          return [name, `${el?.["data-probe"] ?? "MISSING"} / ${el?.["aria-label"] ?? "MISSING"}`];
        }),
      ),
    ).toEqual(expected(FORWARDING, `${PROBE_ESCAPED} / ${LABEL_ESCAPED}`));
  });

  it("emits its own data-slot token first and composes an inherited one after it", () => {
    expect(
      Object.fromEntries(
        FORWARDING.map((name) => {
          const slot = PARTICIPANTS[name]?.slot as string;
          return [name, elementBySlot(RENDERED[name] as string, slot)?.["data-slot"] ?? "MISSING"];
        }),
      ),
    ).toEqual(Object.fromEntries(FORWARDING.map((name) => [name, `${PARTICIPANTS[name]?.slot} inherited`])));
  });

  it("merges a caller class through cn so it evicts the component's own conflicting default", () => {
    expect(
      Object.fromEntries(
        NAMES.filter((name) => name !== "Honeypot").map((name) => {
          const participant = PARTICIPANTS[name] as Participant;
          const el = elementBySlot(RENDERED[name] as string, participant.classSlot ?? participant.slot);
          const padding = (el?.class ?? "")
            .split(" ")
            .filter((token) => !token.includes(":"))
            .filter((token) => /^p([xytrbl]|[se])?-/.test(token));
          return [name, padding.join(" ")];
        }),
      ),
    ).toEqual(
      expected(
        NAMES.filter((name) => name !== "Honeypot"),
        CALLER_CLASS,
      ),
    );
  });

  it("drops style outright while still forwarding the props alongside it", () => {
    expect(
      Object.fromEntries(
        FORWARDING.map((name) => {
          const el = elementBySlot(RENDERED[name] as string, PARTICIPANTS[name]?.slot as string);
          const forwarded = el?.["data-probe"] === PROBE_ESCAPED ? "forwarded" : "NOT-FORWARDED";
          return [name, `${forwarded} / ${el && "style" in el ? `style=${el.style}` : "no-style"}`];
        }),
      ),
    ).toEqual(expected(FORWARDING, "forwarded / no-style"));
  });

  it("lets a caller's explicit state attribute beat the one the component computed", () => {
    expect(
      Object.fromEntries(
        Object.entries(STATE_PARTICIPANTS).map(([name, attr]) => {
          const el = elementBySlot(OVERRIDDEN[name] as string, PARTICIPANTS[name]?.slot as string);
          return [name, `${attr}=${el?.[attr] ?? "MISSING"}`];
        }),
      ),
    ).toEqual(Object.fromEntries(Object.entries(STATE_PARTICIPANTS).map(([name, attr]) => [name, `${attr}=${STATE_OVERRIDE}`])));
  });
});
