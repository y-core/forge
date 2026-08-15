/** How a demo's presence is detected inside a section body. @internal */
export type CoverageMarker =
  | { kind: "attr"; name: string; value: string }
  | { kind: "slot"; token: string }
  | { kind: "class"; token: string }
  | { kind: "pattern"; source: string };

/** One axis of a component the catalog is expected to demonstrate. @internal */
export interface CoverageAxis {
  axis: string;
  value: string;
  marker: CoverageMarker;
}

/** One component the catalog is expected to demonstrate, and the axes it must show. @internal */
export interface CoverageDemo {
  name: string;
  barrel: "core" | "controls" | "chrome" | "server" | "extra";
  /** The catalog section that demonstrates it, or `PAGE_WIDE` for a component the shell mounts. */
  section: string;
  where: string;
  axes: readonly CoverageAxis[];
}

/** What the rendered catalog demonstrates, and what it does not. @internal */
export interface CoverageReport {
  covered: readonly string[];
  uncovered: readonly string[];
}

/** What {@link coverageReport} reads the catalog from. @internal */
export interface CoverageReportOptions {
  /** One rendered page per entry; every section id renders on exactly one of them. */
  html: readonly string[];
  sectionIds: readonly string[];
  demos: readonly CoverageDemo[];
}

const SECTION_TAG = /<section(?: id="([^"]+)")?[^>]*>|<\/section>/g;
const SLOT_ATTR = /data-slot="([^"]*)"/g;
const CLASS_ATTR = /class="([^"]*)"/g;

/** A demo whose component the page shell mounts, so it sits outside every catalog section. @internal */
export const PAGE_WIDE = "*";

const MISSING_FILE = "src/ui/show/coverage-missing.ts";
const COMPONENTS_FILE = "src/ui/show/components.tsx";

/** Every catalog section body, keyed by its id.
 *
 * A section's body runs to its own matching `</section>`, not to the next `<section>`: the catalog
 * nests bands (`sections.tsx`'s six inside the HTMX band), and slicing at the next opening tag cut
 * a parent's body off at its first child — silently under-reporting everything after it. @internal */
export function sectionBodies(html: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const tags = [...html.matchAll(SECTION_TAG)];

  for (const [index, tag] of tags.entries()) {
    const id = tag[1];
    if (id === undefined) continue;
    let depth = 0;
    for (const later of tags.slice(index)) {
      depth += later[0].startsWith("</") ? -1 : 1;
      if (depth !== 0) continue;
      bodies.set(id, html.slice(tag.index ?? 0, (later.index ?? 0) + later[0].length));
      break;
    }
  }
  return bodies;
}

function demoKey(demo: CoverageDemo): string {
  return `${demo.barrel}/${demo.name}`;
}

function axisKey(demo: CoverageDemo, axis: CoverageAxis): string {
  return `${demoKey(demo)}#${axis.axis}=${axis.value}`;
}

function tokens(body: string, attr: RegExp): Set<string> {
  const found = new Set<string>();
  for (const match of body.matchAll(attr)) {
    for (const token of (match[1] ?? "").split(/\s+/)) found.add(token);
  }
  return found;
}

function marked(body: string, marker: CoverageMarker): boolean {
  if (marker.kind === "attr") return body.includes(`${marker.name}="${marker.value}"`);
  if (marker.kind === "slot") return tokens(body, SLOT_ATTR).has(marker.token);
  if (marker.kind === "class") return tokens(body, CLASS_ATTR).has(marker.token);
  return new RegExp(marker.source).test(body);
}

/** Every key the manifest can produce — one per demo, one per axis. @internal */
export function coverageKeys(demos: readonly CoverageDemo[]): readonly string[] {
  return demos.flatMap((demo) => [demoKey(demo), ...demo.axes.map((axis) => axisKey(demo, axis))]);
}

/** Splits the manifest into what the rendered catalog demonstrates and what it does not. @internal */
export function coverageReport({ html, sectionIds, demos }: CoverageReportOptions): CoverageReport {
  const bodies = new Map(html.flatMap((page) => [...sectionBodies(page)]));
  const declared = new Set(sectionIds);
  const covered: string[] = [];
  const uncovered: string[] = [];

  // The whole page, for the shell's own components: `FlashContainer` is mounted once per page and
  // is deliberately not inside a section, so section-scoping it would report a gap that is a
  // property of the contract rather than of the catalog.
  const wholePage = html.join("");

  for (const demo of demos) {
    const body = demo.section === PAGE_WIDE ? wholePage : declared.has(demo.section) ? bodies.get(demo.section) : undefined;
    if (body === undefined) {
      uncovered.push(demoKey(demo));
      continue;
    }
    covered.push(demoKey(demo));
    for (const axis of demo.axes) {
      (marked(body, axis.marker) ? covered : uncovered).push(axisKey(demo, axis));
    }
  }

  return { covered, uncovered };
}

function markerPhrase(marker: CoverageMarker): string {
  if (marker.kind === "attr") return `${marker.name}="${marker.value}"`;
  if (marker.kind === "slot") return `data-slot~="${marker.token}"`;
  if (marker.kind === "class") return `class token "${marker.token}"`;
  return `markup matching /${marker.source}/`;
}

/** Says what the catalog must render for an uncovered key, and what to delete once it does. @internal */
export function explainGap(key: string, demos: readonly CoverageDemo[]): string {
  const [head, tail] = key.split("#");
  const demo = demos.find((candidate) => demoKey(candidate) === head);
  if (!demo) return `${key} is not a key DEMO_COVERAGE can produce.`;

  const removal = `delete "${key}" from COVERAGE_MISSING in ${MISSING_FILE}.`;
  if (tail === undefined) {
    return `${key} — no <section id="${demo.section}"> in the rendered catalog. Add ${demo.where} to ${COMPONENTS_FILE} and a { id: "${demo.section}" } entry to SECTIONS, then ${removal}`;
  }

  const axis = demo.axes.find((candidate) => axisKey(demo, candidate) === key);
  if (!axis) return `${key} is not a key DEMO_COVERAGE can produce.`;
  return `${key} — ${demo.where} in ${COMPONENTS_FILE} renders no element with ${markerPhrase(axis.marker)}. Add one, then ${removal}`;
}

/** Says that an excused key is now covered and the excuse must go. @internal */
export function explainStale(key: string): string {
  return `${key} is listed in COVERAGE_MISSING but the catalog now covers it. Delete the entry — the list only shrinks.`;
}

const ORIENTATION_VERTICAL: CoverageAxis = {
  axis: "orientation",
  value: "vertical",
  marker: { kind: "attr", name: "data-orientation", value: "vertical" },
};
const ORIENTATION_HORIZONTAL: CoverageAxis = {
  axis: "orientation",
  value: "horizontal",
  marker: { kind: "attr", name: "data-orientation", value: "horizontal" },
};

function child(name: string, token: string): CoverageAxis {
  return { axis: "child", value: name, marker: { kind: "slot", token } };
}

function boundControl(slot: string): CoverageAxis {
  return { axis: "bound", value: "field", marker: { kind: "pattern", source: `data-slot="${slot}"[^>]*data-field="` } };
}

// One default instance shows the binding exists; a second on its own field is what shows the binding
// is per-field rather than per-component, and it is the only place a non-default state is rendered.
function secondField(field: string): CoverageAxis {
  return { axis: "second", value: field, marker: { kind: "attr", name: "data-field", value: field } };
}

// A regex and not a slot token: `asChild` merges onto the caller's element, so the attribute order
// of the composed `<a>` differs from the non-asChild render path.
function asChildLink(slot: string): CoverageAxis {
  return { axis: "asChild", value: "link", marker: { kind: "pattern", source: `<a [^>]*data-slot="(?:[^"]* )?${slot}(?:[ "])` } };
}

/** Every component the showcase owes a demo, and every axis that demo owes. @internal */
export const DEMO_COVERAGE: readonly CoverageDemo[] = [
  {
    name: "Accordion",
    barrel: "core",
    section: "accordion",
    where: "AccordionSection",
    axes: [
      { axis: "open", value: "true", marker: { kind: "pattern", source: "<details[^>]*open" } },
      { axis: "exclusive", value: "name", marker: { kind: "pattern", source: "<details[^>]*name=" } },
    ],
  },
  {
    name: "Alert",
    barrel: "core",
    section: "alert",
    where: "AlertSection",
    axes: [
      { axis: "variant", value: "default", marker: { kind: "attr", name: "data-variant", value: "default" } },
      { axis: "variant", value: "destructive", marker: { kind: "attr", name: "data-variant", value: "destructive" } },
      { axis: "variant", value: "info", marker: { kind: "attr", name: "data-variant", value: "info" } },
      { axis: "variant", value: "success", marker: { kind: "attr", name: "data-variant", value: "success" } },
      { axis: "variant", value: "warning", marker: { kind: "attr", name: "data-variant", value: "warning" } },
      { axis: "dismissible", value: "true", marker: { kind: "slot", token: "alert-dismiss" } },
    ],
  },
  {
    name: "Avatar",
    barrel: "core",
    section: "avatar",
    where: "AvatarSection",
    axes: [
      { axis: "size", value: "sm", marker: { kind: "attr", name: "data-size", value: "sm" } },
      { axis: "size", value: "md", marker: { kind: "attr", name: "data-size", value: "md" } },
      { axis: "size", value: "lg", marker: { kind: "attr", name: "data-size", value: "lg" } },
      child("Image", "avatar-image"),
    ],
  },
  {
    name: "Badge",
    barrel: "core",
    section: "badge",
    where: "BadgeSection",
    axes: [
      { axis: "variant", value: "info", marker: { kind: "attr", name: "data-variant", value: "info" } },
      { axis: "variant", value: "success", marker: { kind: "attr", name: "data-variant", value: "success" } },
      { axis: "variant", value: "warning", marker: { kind: "attr", name: "data-variant", value: "warning" } },
    ],
  },
  {
    name: "Button",
    barrel: "core",
    section: "button",
    where: "ButtonSection",
    axes: [
      { axis: "variant", value: "destructive", marker: { kind: "class", token: "bg-destructive" } },
      { axis: "size", value: "sm", marker: { kind: "class", token: "h-8" } },
      { axis: "size", value: "lg", marker: { kind: "class", token: "h-12" } },
      { axis: "size", value: "icon", marker: { kind: "class", token: "size-9" } },
      { axis: "size", value: "icon-sm", marker: { kind: "class", token: "size-8" } },
      { axis: "size", value: "square", marker: { kind: "class", token: "aspect-square" } },
    ],
  },
  { name: "Card", barrel: "core", section: "card", where: "CardSection", axes: [child("Action", "card-action")] },
  { name: "CheckboxGroup", barrel: "core", section: "checkbox-group", where: "CheckboxGroupSection", axes: [ORIENTATION_VERTICAL] },
  {
    name: "Collapsible",
    barrel: "core",
    section: "collapsible",
    where: "CollapsibleSection",
    axes: [
      { axis: "open", value: "true", marker: { kind: "pattern", source: 'data-slot="collapsible"[^>]*open' } },
      { axis: "exclusive", value: "name", marker: { kind: "pattern", source: 'data-slot="collapsible"[^>]*name=' } },
    ],
  },
  {
    name: "Dialog",
    barrel: "core",
    section: "dialog",
    where: "DialogSection",
    axes: [
      child("Header", "dialog-header"),
      child("Body", "dialog-body"),
      child("Footer", "dialog-footer"),
      { axis: "open", value: "non-modal", marker: { kind: "pattern", source: "<dialog[^>]*open" } },
      { axis: "close", value: "request", marker: { kind: "attr", name: "command", value: "request-close" } },
    ],
  },
  {
    name: "Field",
    barrel: "core",
    section: "field",
    where: "FieldStackSection",
    axes: [{ axis: "orientation", value: "horizontal", marker: { kind: "attr", name: "data-orientation", value: "horizontal" } }],
  },
  {
    name: "Form",
    barrel: "core",
    section: "form",
    where: "FormSection",
    axes: [
      { axis: "method", value: "post", marker: { kind: "pattern", source: '<form[^>]*method="post"' } },
      { axis: "method", value: "get", marker: { kind: "pattern", source: '<form[^>]*method="get"' } },
      { axis: "csrfField", value: "custom", marker: { kind: "pattern", source: 'data-slot="form-csrf"[^>]*name="_token"' } },
    ],
  },
  {
    name: "FormField",
    barrel: "core",
    section: "form-field",
    where: "FormFieldSection",
    axes: [
      ORIENTATION_VERTICAL,
      child("Set", "field-set"),
      child("Legend", "field-legend"),
      child("Content", "field-content"),
      child("Title", "field-title"),
      child("Separator", "field-separator"),
    ],
  },
  {
    name: "Honeypot",
    barrel: "core",
    section: "honeypot",
    where: "HoneypotSection",
    // A honeypot is closed by design: it has no slot and no addressable hook, so its own
    // `aria-hidden`/`tabindex` pair is the only thing that proves one was rendered at all.
    axes: [
      { axis: "trap", value: "off-screen", marker: { kind: "pattern", source: '<input[^>]*tabindex="-1"' } },
      { axis: "field", value: "custom", marker: { kind: "attr", name: "name", value: "company-website" } },
    ],
  },
  {
    name: "Icon",
    barrel: "core",
    section: "icon",
    where: "IconSection",
    axes: [
      { axis: "glyph", value: "hamburger", marker: { kind: "pattern", source: "#icon-hamburger" } },
      { axis: "glyph", value: "close", marker: { kind: "pattern", source: "#icon-close" } },
      { axis: "labelled", value: "role-img", marker: { kind: "attr", name: "role", value: "img" } },
    ],
  },
  {
    name: "Input",
    barrel: "core",
    section: "input",
    where: "InputSection",
    axes: [
      { axis: "type", value: "email", marker: { kind: "attr", name: "type", value: "email" } },
      { axis: "type", value: "password", marker: { kind: "attr", name: "type", value: "password" } },
      { axis: "disabled", value: "true", marker: { kind: "pattern", source: 'data-slot="input"[^>]*disabled' } },
      { axis: "invalid", value: "descriptor", marker: { kind: "pattern", source: 'data-slot="input"[^>]*aria-invalid' } },
      { axis: "readonly", value: "true", marker: { kind: "pattern", source: 'data-slot="input"[^>]*readonly' } },
      { axis: "required", value: "true", marker: { kind: "pattern", source: 'data-slot="input"[^>]*required' } },
    ],
  },
  {
    name: "Label",
    barrel: "core",
    section: "label",
    where: "LabelSection",
    axes: [{ axis: "required", value: "marker", marker: { kind: "slot", token: "label-required" } }],
  },
  {
    name: "Menu",
    barrel: "core",
    section: "menu",
    where: "MenuSection",
    axes: [
      { axis: "side", value: "top", marker: { kind: "attr", name: "data-side", value: "top" } },
      { axis: "align", value: "end", marker: { kind: "attr", name: "data-align", value: "end" } },
      child("LinkItem", "menu-link-item"),
      child("SubmenuTrigger", "menu-submenu-trigger"),
    ],
  },
  {
    name: "Meter",
    barrel: "core",
    section: "meter",
    where: "MeterSection",
    axes: [
      { axis: "thresholds", value: "low-high", marker: { kind: "pattern", source: "<meter[^>]*low=[^>]*high=" } },
      { axis: "optimum", value: "set", marker: { kind: "pattern", source: "<meter[^>]*optimum=" } },
      { axis: "thresholds", value: "none", marker: { kind: "pattern", source: "<meter(?:(?!low=)[^>])*>" } },
      { axis: "value", value: "over-high", marker: { kind: "pattern", source: '<meter[^>]*value="0.94"' } },
    ],
  },
  {
    name: "NumberField",
    barrel: "core",
    section: "number-field",
    where: "NumberFieldSection",
    axes: [
      { axis: "steppers", value: "both", marker: { kind: "slot", token: "number-field-decrement" } },
      { axis: "bounds", value: "min-max", marker: { kind: "pattern", source: "<input[^>]*min=[^>]*max=" } },
      { axis: "step", value: "set", marker: { kind: "pattern", source: "<input[^>]*step=" } },
      { axis: "disabled", value: "true", marker: { kind: "pattern", source: 'data-slot="number-field-input"[^>]*disabled' } },
      { axis: "label", value: "custom", marker: { kind: "attr", name: "aria-label", value: "Decrease quantity" } },
    ],
  },
  {
    name: "Popover",
    barrel: "core",
    section: "popover",
    where: "PopoverSection",
    axes: [
      { axis: "side", value: "top", marker: { kind: "attr", name: "data-side", value: "top" } },
      { axis: "align", value: "end", marker: { kind: "attr", name: "data-align", value: "end" } },
    ],
  },
  { name: "Progress", barrel: "core", section: "progress", where: "ProgressSection", axes: [ORIENTATION_VERTICAL] },
  { name: "RadioGroup", barrel: "core", section: "radio-group", where: "RadioGroupSection", axes: [ORIENTATION_HORIZONTAL, ORIENTATION_VERTICAL] },
  { name: "ScrollArea", barrel: "core", section: "scroll-area", where: "ScrollAreaSection", axes: [ORIENTATION_VERTICAL, ORIENTATION_HORIZONTAL] },
  { name: "Select", barrel: "core", section: "select", where: "SelectSection", axes: [child("OptGroup", "select-optgroup")] },
  {
    name: "Separator",
    barrel: "core",
    section: "separator",
    where: "SeparatorSection",
    axes: [{ axis: "orientation", value: "vertical", marker: { kind: "attr", name: "aria-orientation", value: "vertical" } }],
  },
  {
    name: "Skeleton",
    barrel: "core",
    section: "skeleton",
    where: "SkeletonSection",
    // Skeleton declares no variants at all — it is sized entirely by the caller's class, so the one
    // thing there is to assert is that the block it always renders is present.
    axes: [{ axis: "shape", value: "caller-sized", marker: { kind: "class", token: "motion-safe:animate-pulse" } }],
  },
  {
    name: "Slider",
    barrel: "core",
    section: "slider",
    where: "SliderSection",
    axes: [{ axis: "orientation", value: "vertical", marker: { kind: "class", token: "[writing-mode:vertical-lr]" } }],
  },
  {
    name: "Spinner",
    barrel: "core",
    section: "spinner",
    where: "SpinnerSection",
    axes: [
      // Not size: that lives on the *bound icon's* class, which the coverage test stubs out, so no
      // marker could ever see it. The label is a real variant and is rendered by the component itself.
      { axis: "label", value: "custom", marker: { kind: "pattern", source: '<span class="sr-only motion-reduce:not-sr-only">Fetching' } },
    ],
  },
  {
    name: "Switch",
    barrel: "core",
    section: "switch",
    where: "SwitchSection",
    axes: [{ axis: "orientation", value: "label-before", marker: { kind: "attr", name: "data-label-position", value: "before" } }],
  },
  { name: "Tabs", barrel: "core", section: "tabs", where: "TabsSection", axes: [ORIENTATION_VERTICAL] },
  {
    name: "Textarea",
    barrel: "core",
    section: "textarea",
    where: "TextareaSection",
    axes: [
      { axis: "rows", value: "set", marker: { kind: "pattern", source: "<textarea[^>]*rows=" } },
      { axis: "disabled", value: "true", marker: { kind: "pattern", source: "<textarea[^>]*disabled" } },
      { axis: "invalid", value: "descriptor", marker: { kind: "pattern", source: "<textarea[^>]*aria-invalid" } },
      { axis: "readonly", value: "true", marker: { kind: "pattern", source: "<textarea[^>]*readonly" } },
      { axis: "required", value: "true", marker: { kind: "pattern", source: "<textarea[^>]*required" } },
    ],
  },
  {
    name: "Toast",
    barrel: "core",
    section: "toast",
    where: "ToastCatalog",
    axes: [
      { axis: "position", value: "top-left", marker: { kind: "attr", name: "data-position", value: "top-left" } },
      { axis: "duration", value: "serialised", marker: { kind: "pattern", source: 'data-state="\\{&quot;duration&quot;:\\d+\\}"' } },
    ],
  },
  {
    name: "Toggle",
    barrel: "core",
    section: "toggle",
    where: "ToggleSection",
    axes: [
      { axis: "backing", value: "checkbox", marker: { kind: "pattern", source: 'data-slot="toggle-input" type="checkbox"' } },
      { axis: "pressed", value: "true", marker: { kind: "pattern", source: 'class="sr-only" checked' } },
      { axis: "disabled", value: "true", marker: { kind: "pattern", source: 'data-slot="toggle-input"[^>]*disabled' } },
    ],
  },
  { name: "ToggleGroup", barrel: "core", section: "toggle-group", where: "ToggleGroupSection", axes: [ORIENTATION_VERTICAL] },
  { name: "Toolbar", barrel: "core", section: "toolbar", where: "ToolbarSection", axes: [ORIENTATION_VERTICAL, asChildLink("toolbar-button")] },
  {
    name: "Tooltip",
    barrel: "core",
    section: "tooltip",
    where: "TooltipSection",
    axes: [
      asChildLink("tooltip-trigger"),
      { axis: "side", value: "bottom", marker: { kind: "attr", name: "data-side", value: "bottom" } },
      { axis: "align", value: "end", marker: { kind: "attr", name: "data-align", value: "end" } },
    ],
  },
  {
    name: "Turnstile",
    barrel: "core",
    section: "turnstile-widget",
    where: "TurnstileSection",
    axes: [
      { axis: "size", value: "compact", marker: { kind: "attr", name: "data-size", value: "compact" } },
      { axis: "size", value: "flexible", marker: { kind: "attr", name: "data-size", value: "flexible" } },
    ],
  },
  {
    name: "Input",
    barrel: "controls",
    section: "controls-input",
    where: "ControlsInputSection",
    axes: [boundControl("input"), secondField("email")],
  },
  {
    name: "Select",
    barrel: "controls",
    section: "controls-select",
    where: "ControlsSelectSection",
    axes: [boundControl("select"), secondField("precision")],
  },
  {
    name: "Slider",
    barrel: "controls",
    section: "controls-slider",
    where: "ControlsSliderSection",
    axes: [boundControl("slider"), secondField("zoom")],
  },
  {
    name: "Switch",
    barrel: "controls",
    section: "controls-switch",
    where: "ControlsSwitchSection",
    axes: [boundControl("switch-input"), secondField("notifications")],
  },
  {
    name: "Textarea",
    barrel: "controls",
    section: "controls-textarea",
    where: "ControlsTextareaSection",
    axes: [boundControl("textarea"), secondField("summary")],
  },
  {
    name: "ToggleGroup",
    barrel: "controls",
    section: "controls-toggle-group",
    where: "ControlsToggleGroupSection",
    axes: [boundControl("toggle-group-input"), secondField("weight")],
  },
  {
    name: "NumberField",
    barrel: "controls",
    section: "controls-number-field",
    where: "ControlsNumberFieldSection",
    axes: [boundControl("number-field-input")],
  },
  { name: "Toggle", barrel: "controls", section: "controls-toggle", where: "ControlsToggleSection", axes: [boundControl("toggle-input")] },
  {
    name: "RadioGroup",
    barrel: "controls",
    section: "controls-radio-group",
    where: "ControlsRadioGroupSection",
    axes: [boundControl("radio-group-input")],
  },
  {
    name: "CheckboxGroup",
    barrel: "controls",
    section: "controls-checkbox-group",
    where: "ControlsCheckboxGroupSection",
    axes: [boundControl("checkbox-group-input")],
  },
  {
    name: "Navbar",
    barrel: "chrome",
    section: "chrome-navbar",
    where: "ChromeNavbarSection",
    // Navbar carries its placement in the pin classes rather than in a `data-` attribute, so the
    // marker reads the one token unique to each — every other token in the string is shared with
    // at least one sibling placement.
    axes: [
      { axis: "placement", value: "bottom", marker: { kind: "class", token: "md:bottom-0" } },
      { axis: "placement", value: "right", marker: { kind: "class", token: "md:right-0" } },
    ],
  },
  {
    name: "ThemeToggle",
    barrel: "chrome",
    section: "theme",
    where: "ThemeSection",
    // Three icons, one visible at a time: the CSS picks by preference, so all three ship in markup.
    axes: [
      { axis: "cycle", value: "three-way", marker: { kind: "class", token: "theme-system-icon" } },
      { axis: "size", value: "custom", marker: { kind: "attr", name: "width", value: "24" } },
    ],
  },
  {
    name: "Toolbar",
    barrel: "chrome",
    section: "chrome-toolbar",
    where: "ChromeToolbarSection",
    axes: [
      { axis: "placement", value: "left", marker: { kind: "attr", name: "data-placement", value: "left" } },
      { axis: "placement", value: "right", marker: { kind: "attr", name: "data-placement", value: "right" } },
      { axis: "placement", value: "bottom", marker: { kind: "attr", name: "data-placement", value: "bottom" } },
      { axis: "flyout", value: "popover", marker: { kind: "slot", token: "toolbar-flyout" } },
    ],
  },
  {
    name: "Flash",
    barrel: "server",
    section: "flash",
    where: "FlashSection",
    axes: [
      { axis: "type", value: "success", marker: { kind: "attr", name: "data-variant", value: "success" } },
      { axis: "type", value: "destructive", marker: { kind: "attr", name: "data-variant", value: "destructive" } },
    ],
  },
  {
    name: "FlashContainer",
    barrel: "server",
    section: PAGE_WIDE,
    where: "the page shell, which mounts exactly one",
    axes: [{ axis: "region", value: "container", marker: { kind: "slot", token: "toast-container" } }],
  },
  {
    name: "FlashOob",
    barrel: "server",
    section: "flash",
    where: "FlashSection",
    axes: [{ axis: "swap", value: "oob", marker: { kind: "pattern", source: "hx-swap-oob=" } }],
  },
  {
    name: "Resumable",
    barrel: "server",
    section: "resumable",
    where: "ResumableSection",
    axes: [{ axis: "scope", value: "state", marker: { kind: "pattern", source: 'data-scope="[^"]+" data-state=' } }],
  },
  {
    name: "Lazy",
    barrel: "extra",
    section: "lazy",
    where: "LazySection",
    axes: [{ axis: "anchor", value: "data-ref", marker: { kind: "pattern", source: 'data-scope="show-lazy"' } }],
  },
];
