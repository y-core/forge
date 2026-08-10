/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import type { FC } from "../../jsx/types";
import { render } from "../../testing/render";
import { STATE_ATTRS } from "../contracts/state-attrs";
import { createIcon } from "./icon";
// The subject of this file *is* the export surface, which is TESTING.md §2c's second exception: a
// sweep that reads a hand-kept list of component names would pass on the very day someone adds a
// component and forgets it, which is the only failure this file exists to catch. Enumerating from
// the barrel is what makes "a new component must declare itself" enforceable rather than aspirational.
// (`./mod` is a same-directory import, so biome's `../**/mod` sibling-barrel restriction does not
// apply here and no suppression is needed.)
import * as core from "./mod";

/**
 * The shared conformance sweep over `ui/core` — forge's answer to base-ui's `describeConformance`.
 *
 * Every component in the barrel is asserted against the five contracts `src/ui/README.md`
 * ("Attribute pass-through contract"), `UI_SSR_COMPONENTS.md` and `CLAUDE.md` already commit to:
 *
 * 1. arbitrary `data-*` / `aria-*` props reach the target element, HTML-escaped
 * 2. a caller's `class` merges through `cn` and **wins** over the component's own default
 * 3. `style` is dropped outright — forge's CSP carries no `style-src 'unsafe-inline'`
 * 4. a `data-slot` token is emitted, and an inherited one composes onto it
 * 5. a caller's explicit **state attribute** wins over the one the component computed — the second
 *    expression of the same precedence rule as (2), and the one that until now held only as a
 *    coincidence of where each component happened to put `{...stateAttrs(…)}` relative to
 *    `{...props}`
 *
 * **Roots only, and that is a decision rather than an omission.** Compound members
 * (`Card.Header`, `Select.Option`, `Tabs.Panel`, …) are out of scope. Including them means a
 * fixture row per member — `Tabs.Tab` needs `for`, `Tabs.Panel` needs `id`, `Meter.Track` needs
 * `value`, `CheckboxGroup.Item` needs `name` *and* `value`, `Accordion.Trigger` needs an `icon` —
 * roughly eighty hand-written rows guarding a table whose entire worth is that every row is
 * identical. That trade inverts at the root level, where the fixture cost is ten entries and the
 * failure it catches (a whole new component wired up without the contracts) is the one that
 * actually happens. Compound members keep their exact-HTML pins in their own co-located files.
 *
 * **The participant list is derived, never written down.** `PARTICIPANTS` is checked against the
 * barrel's own uppercase function exports below, so adding a component to `mod.ts` fails this file
 * until the component declares how it participates — including declaring that it does not.
 */

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-spinner": "0 0 16 16" });

/** Deliberately ugly: every character in TESTING.md §3a's encoding map that is legal in an
 * attribute value, so a renderer that stopped escaping is caught by value and not merely by
 * presence. */
const PROBE_RAW = `R&D's "n" <x>`;
const PROBE_ESCAPED = "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;";
const LABEL_RAW = `R&D's`;
const LABEL_ESCAPED = "R&amp;D&#39;s";

/** A padding utility no component uses, in a conflict group several components *do* use
 * (`p-0` on the fieldset groups, `px-3 py-2` on the text controls). `cn` must therefore both keep
 * it and evict theirs — a caller class that merely survived alongside the default would not be
 * winning anything. */
const CALLER_CLASS = "p-99";

/** A state-attribute value no component can compute: it is neither an `Orientation`, a `Side`, an
 * `Align`, nor the empty string a presence hook emits. Seeing it back means the caller's attribute
 * survived; seeing `horizontal` / `vertical` / `""` means the component's did. */
const STATE_OVERRIDE = "caller-wins";

interface Participant {
  /** Fixture props for a component that cannot render without them. */
  readonly props?: Record<string, unknown>;
  /** The first `data-slot` token on the element that receives forwarded props. README calls this
   * "its root (or designated inner) element". */
  readonly slot: string;
  /** The first `data-slot` token on the element that receives the caller's `class`, when that is a
   * different element from the one above. */
  readonly classSlot?: string;
  /** The state attribute this component stamps onto the element that receives caller props — the
   * one a caller's explicit value has to beat. Absent means it computes none *there*, which the
   * guard test below verifies against the render rather than taking on trust. */
  readonly stateAttr?: string;
  /** Set to the reason this component is excluded from the forwarding and `data-slot` contracts.
   * A string here is a visible decision; the guard test below still requires the entry to exist. */
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
  Collapsible: { slot: "collapsible", stateAttr: "data-closed" },
  Dialog: { props: { id: "d1" }, slot: "dialog", stateAttr: "data-closed" },
  Field: { props: { label: "L" }, slot: "field", stateAttr: "data-orientation" },
  // `Form` is the one participant whose `class` is not routed through `cn`: it is never destructured
  // and rides to the element inside `{...formProps}` (form.tsx). It passes the class contract
  // because `Form` declares no base classes at all, so there is nothing for a caller to have to beat
  // — a latent hazard rather than a present bug, and reported as such.
  Form: { slot: "form" },
  FormField: { props: { name: "ff" }, slot: "field", stateAttr: "data-orientation" },
  // A decoy field is deliberately closed: its props type is `{ field?: string }`, its wrapper class
  // is fixed, and it emits no `data-slot`. Letting a caller style or mark the honeypot would make it
  // addressable, which is the one thing it must not be.
  Honeypot: { slot: "", noForward: "closed by design — a honeypot must not be addressable" },
  // `IconProps` is a closed prop list by design (icon.tsx) and `data-slot='icon'` is a literal
  // with no `data-slot` prop to inherit from. `aria-label` is supported, but as a *declared* prop
  // that switches the glyph to `role='img'` — not as pass-through.
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
  // The designated inner element: the root is a presentational `<div data-slot='select-wrapper'>`
  // that positions the chevron, and both the caller's props and the caller's class land on the
  // `<select>` they are actually about (select.tsx).
  Select: { props: { icon }, slot: "select" },
  Separator: { slot: "separator" },
  Skeleton: { slot: "skeleton" },
  Slider: { slot: "slider" },
  Spinner: { props: { icon }, slot: "spinner" },
  // Split target, and correctly so: forwarded props belong on the `<input>` that is the control,
  // while `class` belongs on the `<label>` that is the layout box.
  Switch: { slot: "switch-input", classSlot: "switch" },
  Tabs: { slot: "tabs", stateAttr: "data-orientation" },
  Textarea: { slot: "textarea" },
  Toast: { slot: "toast" },
  // `pressed` is a fixture prop rather than a default because `stateAttrs` emits presence hooks only
  // when they are on: at the default `pressed={false}` a Toggle computes no state attribute at all,
  // and contract 5 would have nothing to bite on.
  Toggle: { props: { pressed: true }, slot: "toggle", stateAttr: "data-pressed" },
  ToggleGroup: { slot: "toggle-group", stateAttr: "data-orientation" },
  Toolbar: { slot: "toolbar", stateAttr: "data-orientation" },
  Tooltip: { slot: "tooltip" },
  Turnstile: { props: { siteKey: "sk" }, slot: "turnstile" },
};

/** Every uppercase-initial function the barrel publishes — the components, and nothing else.
 * `cn` / `cva` / `createIcon` / `fieldId` are lowercase, and `FIELD_LABEL_CLASSES` is a string. */
function barrelComponentNames(): string[] {
  return Object.keys(core)
    .filter((key) => /^[A-Z]/.test(key))
    .filter((key) => typeof (core as Record<string, unknown>)[key] === "function")
    .sort();
}

/** An open tag's attributes, by name. The renderer escapes `<` and `>` inside attribute values, so
 * no raw angle bracket can appear within a tag and this stays a total parse rather than a guess. */
function openTags(html: string): { readonly tag: string; readonly attrs: Record<string, string> }[] {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)((?:\s[^<>]*)?)\/?>/g)].map((match) => {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) {
      attrs[attr[1] as string] = attr[2] ?? "";
    }
    return { tag: match[1] as string, attrs };
  });
}

/** The element whose *first* `data-slot` token is `slot` — first meaning the component's own token,
 * since `slotToken` appends an inherited one after it. */
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

/** One rendered probe per component, reused by every contract below. Each contract still asserts
 * once, over one table — §3c's render-once/assert-once, applied at the sweep's scale rather than
 * rendering the same 37 trees four times. */
const RENDERED: Record<string, string> = {};
for (const name of NAMES) {
  const participant = PARTICIPANTS[name];
  if (participant) RENDERED[name] = await renderProbe(name, participant);
}

const STATE_ATTR_NAMES = new Set<string>(Object.values(STATE_ATTRS));

/** Which state attribute each component computes **on the very element that receives caller props**
 * — read off the baseline probe above rather than parsed out of the sources, so a component that
 * starts emitting one is detected by its own output.
 *
 * The qualifier is the whole point. `Switch` calls `stateAttrs` too, but on the `<label
 * data-slot='switch'>` that is the layout box, while caller props land on the `<input
 * data-slot='switch-input'>`; those two attribute sets never meet, so there is no precedence
 * question to settle and forcing a row for it would assert a conflict that cannot occur. The
 * compound members that call `stateAttrs` (`Accordion.Item`, `Menu.Popup`, `Tabs.Tab`,
 * `Popover.Content`, `Tooltip.Content`, `Toolbar.Button`, `ToggleGroup.Item`) are out of scope for
 * the same reason every other contract here is roots-only — see the file header. */
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

/** What `PARTICIPANTS` *claims*, in the shape `COMPUTED_STATE` is derived in. The two are compared
 * below, which is what keeps the derivation from going quietly vacuous: were `computedStateAttrs`
 * to start matching nothing, contract 5 would sweep an empty table and pass while asserting nothing
 * at all. A component that begins stamping a state attribute onto its forwarding element fails that
 * comparison until it declares `stateAttr` — at which point contract 5 covers it with no further
 * edit, the same bargain the `slot` field already strikes. */
const STATE_PARTICIPANTS: Record<string, string> = Object.fromEntries(
  Object.entries(PARTICIPANTS)
    .map(([name, participant]) => [name, participant.stateAttr] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
);

/** A second probe per stateful component, this one *also* passing the component's own state
 * attribute explicitly. Two renders rather than one because the pair is the evidence: the baseline
 * establishes which attribute the component computes, and this one establishes who wins when the
 * caller names the same attribute. Asserting the second without the first would not distinguish
 * "the caller won" from "the component never computed anything to lose". */
const OVERRIDDEN: Record<string, string> = {};
for (const [name, attr] of Object.entries(STATE_PARTICIPANTS)) {
  OVERRIDDEN[name] = await renderProbe(name, PARTICIPANTS[name] as Participant, { [attr]: STATE_OVERRIDE });
}

/** `expected(names, value)` — the table every contract is compared against, so the assertion names
 * the offending component in its diff instead of reporting a bare `false`. */
function expected(names: string[], value: string): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, value]));
}

describe("ui/core conformance — the sweep is derived from the barrel", () => {
  it("declares a participation entry for every component the barrel exports", () => {
    expect(Object.keys(PARTICIPANTS).sort()).toEqual(NAMES);
  });

  it("sweeps a meaningful number of components", () => {
    // A guard on the guard: were `barrelComponentNames` to start matching nothing, every table
    // below would compare `{}` to `{}` and this file would pass while asserting literally nothing.
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
          // Every *unmodified* padding utility left on the element. The caller's must be the only
          // survivor: `cn` keeps the later token and drops the earlier one it conflicts with, so a
          // component default that outlived the merge shows up here as a second entry rather than
          // as a silently ineffective class at runtime.
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
    // Both halves in one assertion, per TESTING.md §3d: "no style attribute" is also what a
    // component that forwarded *nothing* would produce, so the absence is only evidence once it is
    // paired with proof that the spread reached the element at all.
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
    // The same precedence as contract 2, by the second mechanism: a caller's `class` beats the
    // component's base through `cn`, and a caller's `data-orientation` beats the component's through
    // spread order — `{...stateAttrs(…)}` before `{...props}`. Invert that order in any component
    // below and its row here reports the value it derived from its own prop instead of the sentinel.
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
