/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FC } from "../jsx/types";
import { render } from "../testing/render";
import { ISLAND_STATE_ATTR } from "./contracts/island-contract";
import { STATE_ATTRS } from "./contracts/state-attrs";
import { PRESENTATION_ATTRS } from "./contracts/vocabulary";
import { WIRING_ATTRS, WIRING_PREFIXES } from "./contracts/wiring-attrs";
import * as controls from "./controls/mod";
import { createIcon } from "./core/icon";
import * as core from "./core/mod";
import { fieldAttr } from "./server/field-attr";

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

/** The field name every bound control's probe binds to. */
const BIND_FIELD = "b";

/** The attribute a bound control stamps, read off the helper that writes it rather than restated. */
const FIELD_ATTR = Object.keys(fieldAttr(BIND_FIELD))[0] as string;

interface Participant {
  /** Fixture props for a component that cannot render without them. */
  readonly props?: Record<string, unknown>;
  /** The first `data-slot` token on the element that receives forwarded props. */
  readonly slot: string;
  /** The first `data-slot` token on the element that receives the caller's `class`, when it differs
   *  from the one that receives forwarded props. Every entry needs a `split` reason beside it. */
  readonly classSlot?: string;
  /** Why this component's class target and prop target are two different elements. */
  readonly split?: string;
  /** The state attribute this component stamps onto the element that receives caller props. */
  readonly stateAttr?: string;
  /** The reason this component is excluded from the forwarding and `data-slot` contracts. */
  readonly noForward?: string;
}

const CORE_PARTICIPANTS: Record<string, Participant> = {
  Accordion: { slot: "accordion" },
  Alert: { slot: "alert" },
  Avatar: { slot: "avatar" },
  Badge: { slot: "badge" },
  Breadcrumbs: { slot: "breadcrumbs" },
  Button: { slot: "button" },
  Card: { slot: "card" },
  Carousel: { slot: "carousel" },
  CheckboxGroup: { props: { name: "cg" }, slot: "checkbox-group", stateAttr: "data-orientation" },
  Collapsible: { slot: "collapsible" },
  Dialog: { props: { id: "d1" }, slot: "dialog" },
  Drawer: { props: { id: "dr1" }, slot: "drawer", stateAttr: "data-side" },
  EmptyState: { slot: "empty-state" },
  Field: { props: { label: "L" }, slot: "field-stack", stateAttr: "data-orientation" },
  FileInput: { slot: "file-input" },
  Filter: { slot: "filter" },
  Form: { slot: "form" },
  FormField: { props: { name: "ff" }, slot: "field", stateAttr: "data-orientation" },
  Honeypot: { slot: "", noForward: "closed by design — a honeypot must not be addressable" },
  Icon: { props: { symbol: "x" }, slot: "icon", noForward: "closed prop list — see IconProps" },
  Indicator: { slot: "indicator" },
  Input: { slot: "input" },
  Join: { slot: "join", stateAttr: "data-orientation" },
  Kbd: { slot: "kbd" },
  Label: { slot: "label" },
  Link: { slot: "link" },
  Menu: { slot: "menu" },
  Meter: { slot: "meter" },
  NumberField: { slot: "number-field" },
  OtpInput: {
    slot: "otp-input",
    classSlot: "otp-input-wrapper",
    split: "the root is the frame that paints the cells; props reach the native field laid onto it",
  },
  Pagination: { slot: "pagination" },
  Popover: { slot: "popover" },
  Progress: { slot: "progress", stateAttr: "data-orientation" },
  RadioGroup: { props: { name: "rg" }, slot: "radio-group", stateAttr: "data-orientation" },
  ScrollArea: { slot: "scroll-area", stateAttr: "data-orientation" },
  Select: {
    props: { icon },
    slot: "select",
    classSlot: "select-wrapper",
    split: "the root is the wrapper the chevron is positioned against; props reach the native select",
  },
  Separator: { slot: "separator" },
  Skeleton: { slot: "skeleton" },
  Slider: { slot: "slider" },
  Spinner: { props: { icon }, slot: "spinner" },
  Stack: { slot: "stack" },
  Stat: { slot: "stat" },
  Status: { props: { label: "S" }, slot: "status" },
  Steps: { slot: "steps", stateAttr: "data-orientation" },
  Switch: {
    slot: "switch-input",
    classSlot: "switch",
    split: "the root is the label carrying the track and thumb; props reach the sr-only checkbox the `peer-*` rules key off",
  },
  Table: { slot: "table" },
  Tabs: { slot: "tabs", stateAttr: "data-orientation" },
  Timeline: { slot: "timeline", stateAttr: "data-orientation" },
  Textarea: { slot: "textarea" },
  Toast: { slot: "toast" },
  Toggle: {
    slot: "toggle-input",
    classSlot: "toggle",
    // No `stateAttr` — the checkbox's own `:checked` is the state, so there is none to stamp.
    split: "same shape as Switch: the root is the label, props reach the sr-only checkbox inside it",
  },
  ToggleGroup: { slot: "toggle-group", stateAttr: "data-orientation" },
  Toolbar: { slot: "toolbar", stateAttr: "data-orientation" },
  Tooltip: { slot: "tooltip" },
  Turnstile: { props: { siteKey: "sk" }, slot: "turnstile" },
};

/** The bound tier renders its `ui/core` twin, so each entry repeats that twin's targets and adds the
 *  props the wrapper requires: `bind` on a bound control, the core fixture props on a bound compound. */
const CONTROL_PARTICIPANTS: Record<string, Participant> = {
  CheckboxGroup: { props: { name: "cg" }, slot: "checkbox-group", stateAttr: "data-orientation" },
  FileInput: { props: { bind: BIND_FIELD }, slot: "file-input" },
  Input: { props: { bind: BIND_FIELD }, slot: "input" },
  NumberField: { slot: "number-field" },
  OtpInput: {
    props: { bind: BIND_FIELD },
    slot: "otp-input",
    classSlot: "otp-input-wrapper",
    split: "the root is the frame that paints the cells; props reach the native field laid onto it",
  },
  RadioGroup: { props: { name: "rg" }, slot: "radio-group", stateAttr: "data-orientation" },
  Select: {
    props: { bind: BIND_FIELD, icon },
    slot: "select",
    classSlot: "select-wrapper",
    split: "the root is the wrapper the chevron is positioned against; props reach the native select",
  },
  Slider: { props: { bind: BIND_FIELD }, slot: "slider" },
  Switch: {
    props: { bind: BIND_FIELD },
    slot: "switch-input",
    classSlot: "switch",
    split: "the root is the label carrying the track and thumb; props reach the sr-only checkbox the `peer-*` rules key off",
  },
  Textarea: { props: { bind: BIND_FIELD }, slot: "textarea" },
  Toggle: {
    props: { bind: BIND_FIELD },
    slot: "toggle-input",
    classSlot: "toggle",
    split: "same shape as Switch: the root is the label, props reach the sr-only checkbox inside it",
  },
  ToggleGroup: { slot: "toggle-group", stateAttr: "data-orientation" },
};

interface Tier {
  readonly barrel: Record<string, unknown>;
  readonly participants: Record<string, Participant>;
  /** The floor this tier's published component count must stay above. */
  readonly floor: number;
}

const TIERS: Record<string, Tier> = {
  controls: { barrel: controls as Record<string, unknown>, participants: CONTROL_PARTICIPANTS, floor: 10 },
  core: { barrel: core as Record<string, unknown>, participants: CORE_PARTICIPANTS, floor: 30 },
};

const TIER_NAMES = Object.keys(TIERS).sort();

/** Every uppercase-initial function a barrel publishes — the components, and nothing else. */
function barrelComponentNames(barrel: Record<string, unknown>): string[] {
  return Object.keys(barrel)
    .filter((key) => /^[A-Z]/.test(key))
    .filter((key) => typeof barrel[key] === "function")
    .sort();
}

/** A tier-qualified component key, because `Input` names a component in both barrels. */
const KEYS = TIER_NAMES.flatMap((tier) => barrelComponentNames((TIERS[tier] as Tier).barrel).map((name) => `${tier}/${name}`));

function tierOf(key: string): Tier {
  return TIERS[key.slice(0, key.indexOf("/"))] as Tier;
}

function participantOf(key: string): Participant | undefined {
  return tierOf(key).participants[key.slice(key.indexOf("/") + 1)];
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

async function renderProbe(key: string, participant: Participant, extra: Record<string, unknown> = {}): Promise<string> {
  const Component = tierOf(key).barrel[key.slice(key.indexOf("/") + 1)] as FC<Record<string, unknown>>;
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

/** Every boolean state prop, set true. A component only emits the six presence hooks when the
 *  corresponding prop is true, so a sweep over a default render reaches none of them — which is how
 *  the six attributes the contract exists for were the ones it never saw. */
const STATEFUL_PROPS = { pressed: true, checked: true, selected: true, disabled: true, invalid: true, busy: true };

const FORWARDING = KEYS.filter((key) => !participantOf(key)?.noForward);

/** One rendered probe per component, reused by every contract below. */
const RENDERED: Record<string, string> = {};
for (const key of KEYS) {
  const participant = participantOf(key);
  if (participant) RENDERED[key] = await renderProbe(key, participant);
}

/** A second probe per component with every boolean state prop set, so the presence hooks are reached. */
const RENDERED_STATEFUL: Record<string, string> = {};
for (const key of KEYS) {
  const participant = participantOf(key);
  if (participant) RENDERED_STATEFUL[key] = await renderProbe(key, participant, STATEFUL_PROPS);
}

const STATE_ATTR_NAMES = new Set<string>(Object.values(STATE_ATTRS));

/** Which state attribute each component computes on the element that receives caller props, read off the baseline probe. */
function computedStateAttrs(key: string): string {
  const el = elementBySlot(RENDERED[key] ?? "", participantOf(key)?.slot ?? "");
  return Object.keys(el ?? {})
    .filter((attr) => STATE_ATTR_NAMES.has(attr))
    .sort()
    .join(" ");
}

const COMPUTED_STATE: Record<string, string> = Object.fromEntries(
  KEYS.map((key) => [key, computedStateAttrs(key)] as const).filter(([, attrs]) => attrs !== ""),
);

/** What the participant tables claim, in the shape `COMPUTED_STATE` is derived in. */
const STATE_PARTICIPANTS: Record<string, string> = Object.fromEntries(
  KEYS.map((key) => [key, participantOf(key)?.stateAttr] as const).filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
);

/** A second probe per stateful component, this one also passing the component's own state attribute explicitly. */
const OVERRIDDEN: Record<string, string> = {};
for (const [key, attr] of Object.entries(STATE_PARTICIPANTS)) {
  OVERRIDDEN[key] = await renderProbe(key, participantOf(key) as Participant, { [attr]: STATE_OVERRIDE });
}

/** The table every contract is compared against, so a diff names the offending component. */
function expected(keys: string[], value: string): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, value]));
}

const RENDER_SWEEP_ONLY = new Set(["data-probe"]);

describe("ui conformance — the sweep is derived from the barrels", () => {
  it("declares a participation entry for every component each barrel exports", () => {
    expect(Object.fromEntries(TIER_NAMES.map((tier) => [tier, barrelComponentNames((TIERS[tier] as Tier).barrel)]))).toEqual(
      Object.fromEntries(TIER_NAMES.map((tier) => [tier, Object.keys((TIERS[tier] as Tier).participants).sort()])),
    );
  });

  it("sweeps a meaningful number of components in every tier", () => {
    expect(TIER_NAMES.filter((tier) => barrelComponentNames((TIERS[tier] as Tier).barrel).length <= (TIERS[tier] as Tier).floor)).toEqual([]);
  });

  it("declares every component that stamps a state attribute onto its forwarding element", () => {
    expect(COMPUTED_STATE).toEqual(STATE_PARTICIPANTS);
  });

  it("emits no data-* attribute that no declaration carries", () => {
    const declared = new Set<string>([...Object.values(STATE_ATTRS), ...Object.values(PRESENTATION_ATTRS), ISLAND_STATE_ATTR]);
    const offenders = new Set<string>();
    // Both probes: the bare render never reaches the six presence hooks, and the stateful one is
    // where an undeclared hook smuggled in behind a boolean prop would appear.
    for (const html of [...Object.values(RENDERED), ...Object.values(RENDERED_STATEFUL)]) {
      for (const { attrs } of openTags(html)) {
        for (const name of Object.keys(attrs)) {
          if (!name.startsWith("data-")) continue;
          if (declared.has(name) || name in WIRING_ATTRS || RENDER_SWEEP_ONLY.has(name)) continue;
          if (WIRING_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
          offenders.add(name);
        }
      }
    }

    // Asserted in this direction and not the other: filtering the rendered attributes down to the
    // declared set before comparing makes the comparison unfalsifiable, which is how undeclared
    // names came to ship past a test whose stated purpose was to stop them.
    expect([...offenders].sort()).toEqual([]);
  });

  // `forge/data-slot-before-spread` enforces the *ordering* of a slot attribute against the
  // forwarded props, never its *placement* on the element tree, so an inner-element token is outside
  // what it can see. Naming each split here is the record; teaching a class-order check about
  // element identity would be a second, weaker copy of this sweep.
  it("gives a reason for every component whose class target and prop target differ", () => {
    const undeclared = KEYS.filter((key) => participantOf(key)?.classSlot !== undefined && !participantOf(key)?.split);
    expect(undeclared).toEqual([]);
  });

  it("declares no split reason for a component whose two targets are the same element", () => {
    const spurious = KEYS.filter((key) => participantOf(key)?.split !== undefined && participantOf(key)?.classSlot === undefined);
    expect(spurious).toEqual([]);
  });

  it("gives every component in a tier a root slot token no sibling in that tier claims", () => {
    const duplicates = TIER_NAMES.flatMap((tier) => {
      const slots = Object.values((TIERS[tier] as Tier).participants)
        .map((participant) => participant.slot)
        .filter((slot) => slot !== "");
      return slots.filter((slot, i) => slots.indexOf(slot) !== i).map((slot) => `${tier}/${slot}`);
    });
    expect(duplicates).toEqual([]);
  });
});

/** Every component source under `ui/core`, `ui/chrome` and `ui/controls`, keyed by its repo-relative path. */
function componentSources(): Record<string, string> {
  const root = import.meta.dir;
  const out: Record<string, string> = {};
  for (const dir of ["core", "chrome", "controls"]) {
    for (const name of readdirSync(resolve(root, dir))) {
      if (!name.endsWith(".tsx") || name.endsWith(".test.tsx")) continue;
      out[`${dir}/${name}`] = readFileSync(resolve(root, dir, name), "utf-8");
    }
  }
  return out;
}

/** A `size` whose values are a third party's, not forge's — with its reason. */
const FOREIGN_SIZE: Record<string, string> = {
  "core/turnstile.tsx": "Cloudflare's widget sizes (`compact` / `flexible` / `normal`) pass through verbatim",
};

/** Likewise `appearance`: Turnstile's is Cloudflare's render mode, not forge's emphasis level. */
const FOREIGN_APPEARANCE: Record<string, string> = {
  "core/turnstile.tsx": "Cloudflare's widget render modes (`always` / `execute` / `interaction-only`) pass through verbatim",
};

/** The seven ratified presentational prop names, and the type each must resolve to. An allowlist,
 *  because a denylist of one name (`variant`) is defeated by every synonym nobody thought of. */
const RATIFIED: Record<string, RegExp> = {
  tone: /Tone\b|ButtonProps\["tone"\]/,
  // A `*Appearance` / `*Size` alias is an `Extract<>` narrowing of the ratified union, not a second
  // vocabulary; an inline `"horizontal" | "vertical"` is the ratified orientation spelled out.
  appearance: /Appearance\b|ButtonProps\["appearance"\]/,
  size: /Size\b|ButtonProps\["size"\]/,
  shape: /Shape\b|ButtonProps\["shape"\]/,
  orientation: /Orientation\b|"horizontal" \| "vertical"/,
  invalid: /\bboolean\b/,
  busy: /\bboolean\b/,
};

/** Presentational-sounding prop names that are not the ratified axes and never may be. `kind` is
 *  absent deliberately: it is the discriminant tag on `ToolbarAction`'s union, not an axis. */
const BANNED_PROP_NAMES = ["variant", "intent", "colour", "emphasis", "look"];

describe("ui conformance — the prop vocabulary (UI_SSR_COMPONENTS.md §1m)", () => {
  const sources = componentSources();

  it("declares no presentational prop outside the seven ratified names", () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      BANNED_PROP_NAMES.filter((name) => new RegExp(`^\\s*${name}\\??:`, "m").test(source)).map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  // An allowlist, not a scan of the declaration *text*: every alias defeated the old orientation
  // check, because they all declared `orientation?: XOrientation` and the check looked for a shape.
  it("types every ratified prop on the union its name is ratified for", () => {
    const exempt: Record<string, Record<string, string>> = { size: FOREIGN_SIZE, appearance: FOREIGN_APPEARANCE };
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      Object.entries(RATIFIED).flatMap(([name, union]) =>
        exempt[name]?.[file] !== undefined
          ? []
          : [...source.matchAll(new RegExp(`^\\s*${name}\\?:\\s*([^;\\n]+)`, "gm"))]
              .map((match) => `${file}: ${name}?: ${match[1]}`)
              .filter((decl) => !union.test(decl)),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // §1n: absent and `undefined` are the same state at runtime, and without the union a caller under
  // `exactOptionalPropertyTypes` writes a guard-form spread that `jsx-a11y` cannot see.
  it("gives every *Props optional an explicit | undefined", () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      [...source.matchAll(/(?:^|\n)(?:export )?(?:interface|type) (\w*(?:Props|Action|Item))\b[^{]*\{([^}]*)\}/g)].flatMap((block) =>
        [...(block[2] ?? "").matchAll(/^\s*(\w+)\?:\s*([^;\n]+);/gm)]
          .filter((prop) => !/\|\s*undefined\s*$/.test((prop[2] ?? "").trim()))
          .map((prop) => `${file}: ${block[1]}.${prop[1]}`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("ui conformance — the five contracts", () => {
  it("forwards arbitrary data-* and aria-* props to the target element, HTML-escaped", () => {
    expect(
      Object.fromEntries(
        FORWARDING.map((key) => {
          const el = elementBySlot(RENDERED[key] as string, participantOf(key)?.slot as string);
          return [key, `${el?.["data-probe"] ?? "MISSING"} / ${el?.["aria-label"] ?? "MISSING"}`];
        }),
      ),
    ).toEqual(expected(FORWARDING, `${PROBE_ESCAPED} / ${LABEL_ESCAPED}`));
  });

  it("emits its own data-slot token first and composes an inherited one after it", () => {
    expect(
      Object.fromEntries(
        FORWARDING.map((key) => {
          const slot = participantOf(key)?.slot as string;
          return [key, elementBySlot(RENDERED[key] as string, slot)?.["data-slot"] ?? "MISSING"];
        }),
      ),
    ).toEqual(Object.fromEntries(FORWARDING.map((key) => [key, `${participantOf(key)?.slot} inherited`])));
  });

  it("merges a caller class through cn so it evicts the component's own conflicting default", () => {
    const classed = KEYS.filter((key) => participantOf(key)?.slot !== "");
    expect(
      Object.fromEntries(
        classed.map((key) => {
          const participant = participantOf(key) as Participant;
          const el = elementBySlot(RENDERED[key] as string, participant.classSlot ?? participant.slot);
          const padding = (el?.class ?? "")
            .split(" ")
            .filter((token) => !token.includes(":"))
            .filter((token) => /^p([xytrbl]|[se])?-/.test(token));
          return [key, padding.join(" ")];
        }),
      ),
    ).toEqual(expected(classed, CALLER_CLASS));
  });

  it("drops style outright while still forwarding the props alongside it", () => {
    expect(
      Object.fromEntries(
        FORWARDING.map((key) => {
          const el = elementBySlot(RENDERED[key] as string, participantOf(key)?.slot as string);
          const forwarded = el?.["data-probe"] === PROBE_ESCAPED ? "forwarded" : "NOT-FORWARDED";
          return [key, `${forwarded} / ${el && "style" in el ? `style=${el.style}` : "no-style"}`];
        }),
      ),
    ).toEqual(expected(FORWARDING, "forwarded / no-style"));
  });

  // Both sides derived from `STATE_PARTICIPANTS` proved only that the input equals itself. The
  // expectation now states the caller's value literally, so a change to the table cannot silently
  // rewrite what this demands.
  it("lets a caller's explicit state attribute beat the one the component computed", () => {
    const resolved = Object.entries(STATE_PARTICIPANTS).map(([key, attr]) => {
      const el = elementBySlot(OVERRIDDEN[key] as string, participantOf(key)?.slot as string);
      return `${key}: ${el?.[attr] ?? "MISSING"}`;
    });

    expect(resolved.filter((row) => !row.endsWith(`: ${STATE_OVERRIDE}`))).toEqual([]);
    expect(resolved.length).toBeGreaterThan(8);
  });
});

const CONTROL_KEYS = KEYS.filter((key) => key.startsWith("controls/"));

describe("ui/controls conformance — the bound tier", () => {
  it("stamps the bound field on the element that receives forwarded props, and on no unbound root", () => {
    expect(
      Object.fromEntries(
        CONTROL_KEYS.map((key) => {
          const el = elementBySlot(RENDERED[key] as string, participantOf(key)?.slot as string);
          return [key, el?.[FIELD_ATTR] ?? "unbound"];
        }),
      ),
    ).toEqual(Object.fromEntries(CONTROL_KEYS.map((key) => [key, participantOf(key)?.props?.["bind"] === undefined ? "unbound" : BIND_FIELD])));
  });

  it("emits its ui/core twin's markup verbatim, adding the bound field and nothing else", () => {
    expect(Object.fromEntries(CONTROL_KEYS.map((key) => [key, (RENDERED[key] as string).replace(` ${FIELD_ATTR}="${BIND_FIELD}"`, "")]))).toEqual(
      Object.fromEntries(CONTROL_KEYS.map((key) => [key, RENDERED[`core/${key.slice("controls/".length)}`]])),
    );
  });
});
