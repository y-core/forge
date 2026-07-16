import type { SafeHtml } from "../http/html";

/** A node in the forge SSR JSX tree. @public */
export type JSXNode = JSXElement | SafeHtml | string | number | boolean | null | undefined | JSXNode[];

/** Component function — accepts any props object, returns a (possibly async) node. @internal */
// biome-ignore lint/suspicious/noExplicitAny: JSX runtime must accept any component signature at the type-erasure level
export type ComponentFn = (...args: any[]) => unknown | Promise<unknown>;

/** An element produced by the forge JSX runtime. Discriminated by `$jsx: true`. @public */
export interface JSXElement {
  type: string | ComponentFn;
  props: Record<string, unknown>;
  key?: unknown;
  $jsx: true;
}

/** Function component: receives props, returns a JSX element (or null for no output). @public */
export type FC<P = Record<string, unknown>> = (props: P & { children?: JSXNode }) => JSXElement | null;

/** @public */
export type PropsWithChildren<P = Record<string, unknown>> = P & { children?: JSXNode };

// ---------------------------------------------------------------------------
// Common attribute sets shared across HTML elements
// ---------------------------------------------------------------------------

interface AriaAttributes {
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-expanded"?: boolean | "true" | "false";
  "aria-controls"?: string;
  "aria-haspopup"?: boolean | "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog";
  "aria-hidden"?: boolean | "true" | "false";
  "aria-live"?: "off" | "assertive" | "polite";
  "aria-atomic"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  "aria-selected"?: boolean | "true" | "false";
  "aria-checked"?: boolean | "true" | "false" | "mixed";
  "aria-disabled"?: boolean | "true" | "false";
  "aria-current"?: boolean | "page" | "step" | "location" | "date" | "time";
  "aria-busy"?: boolean | "true" | "false";
  "aria-orientation"?: "horizontal" | "vertical";
  "aria-placeholder"?: string;
  "aria-autocomplete"?: "none" | "list" | "inline" | "both";
  "aria-multiline"?: boolean | "true" | "false";
  "aria-valuemin"?: number;
  "aria-valuemax"?: number;
  "aria-valuenow"?: number;
  "aria-valuetext"?: string;
  "aria-level"?: number;
  "aria-posinset"?: number;
  "aria-setsize"?: number;
  "aria-rowcount"?: number;
  "aria-rowindex"?: number;
  "aria-rowspan"?: number;
  "aria-colcount"?: number;
  "aria-colindex"?: number;
  "aria-colspan"?: number;
}

interface HtmxAttributes {
  "hx-get"?: string;
  "hx-post"?: string;
  "hx-put"?: string;
  "hx-delete"?: string;
  "hx-patch"?: string;
  "hx-trigger"?: string;
  "hx-target"?: string;
  "hx-swap"?: string;
  "hx-push-url"?: string;
  "hx-select"?: string;
  "hx-select-oob"?: string;
  "hx-include"?: string;
  "hx-encoding"?: string;
  "hx-params"?: string;
  "hx-ext"?: string;
  "hx-confirm"?: string;
  "hx-boost"?: string;
  "hx-headers"?: string;
  "hx-vals"?: string;
  "hx-indicator"?: string;
  "hx-disabled-elt"?: string;
  "hx-swap-oob"?: string;
  "hx-replace-url"?: string;
  "hx-preserve"?: string;
  "hx-request"?: string;
}

/** Attributes shared by all HTML elements. @public */
export interface HTMLAttributes extends AriaAttributes, HtmxAttributes {
  id?: string;
  class?: string;
  style?: string | Record<string, string | number>;
  title?: string;
  lang?: string;
  dir?: "ltr" | "rtl" | "auto";
  hidden?: boolean;
  tabindex?: number;
  nonce?: string;
  slot?: string;
  translate?: "yes" | "no";
  spellcheck?: boolean;
  contenteditable?: boolean | "true" | "false" | "plaintext-only";
  draggable?: boolean | "true" | "false";
  popover?: "" | "auto" | "manual";
  accesskey?: string;
  autocapitalize?: "none" | "off" | "on" | "sentences" | "words" | "characters";
  children?: JSXNode;
  key?: unknown;
  // data-* (catch-all for arbitrary data attributes)
  [key: `data-${string}`]: unknown;
}

interface AnchorAttributes extends HTMLAttributes {
  href?: string;
  target?: "_blank" | "_self" | "_parent" | "_top" | (string & {});
  rel?: string;
  download?: string | boolean;
  hreflang?: string;
  ping?: string;
  referrerpolicy?: ReferrerPolicy;
  type?: string;
}

interface ButtonAttributes extends HTMLAttributes {
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  name?: string;
  value?: string | number;
  form?: string;
  formaction?: string;
  formmethod?: "get" | "post";
  formnovalidate?: boolean;
  formtarget?: string;
  autofocus?: boolean;
  popovertarget?: string;
  popovertargetaction?: "hide" | "show" | "toggle";
  /** Native Invoker Commands: the command activated on the `commandfor` target when the button is
   * pressed. Built-ins (`toggle-popover`, `show-modal`, `close`, …) are handled by the platform;
   * custom commands are `--action` strings routed through the `CommandEvent` scope bridge. */
  command?: string;
  /** Native Invoker Commands: the id of the element this button acts on. */
  commandfor?: string;
}

interface InputAttributes extends HTMLAttributes {
  type?: string;
  name?: string;
  value?: string | number | readonly string[];
  checked?: boolean;
  disabled?: boolean;
  required?: boolean;
  readonly?: boolean;
  placeholder?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  minlength?: number;
  maxlength?: number;
  pattern?: string;
  multiple?: boolean;
  accept?: string;
  autocomplete?: string;
  autofocus?: boolean;
  form?: string;
  list?: string;
  size?: number;
  width?: number | string;
  height?: number | string;
  src?: string;
  alt?: string;
  capture?: "user" | "environment";
}

interface TextareaAttributes extends HTMLAttributes {
  name?: string;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  readonly?: boolean;
  placeholder?: string;
  rows?: number;
  cols?: number;
  minlength?: number;
  maxlength?: number;
  autocomplete?: string;
  autofocus?: boolean;
  form?: string;
  wrap?: "hard" | "soft" | "off";
}

interface SelectAttributes extends HTMLAttributes {
  name?: string;
  value?: string | string[];
  disabled?: boolean;
  required?: boolean;
  multiple?: boolean;
  size?: number;
  autocomplete?: string;
  autofocus?: boolean;
  form?: string;
}

interface OptionAttributes extends HTMLAttributes {
  value?: string;
  disabled?: boolean;
  selected?: boolean;
  label?: string;
}

interface OptgroupAttributes extends HTMLAttributes {
  label?: string;
  disabled?: boolean;
}

interface FormAttributes extends HTMLAttributes {
  action?: string;
  method?: "get" | "post";
  enctype?: "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
  novalidate?: boolean;
  target?: string;
  autocomplete?: "on" | "off";
  name?: string;
  rel?: string;
}

interface LabelAttributes extends HTMLAttributes {
  // `| undefined` lets a label keep `for={maybeId}` statically visible (so a11y lint can see the
  // association) while satisfying `exactOptionalPropertyTypes` when the id resolves to undefined.
  for?: string | undefined;
  form?: string;
}

interface ImgAttributes extends HTMLAttributes {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  srcset?: string;
  sizes?: string;
  crossorigin?: "anonymous" | "use-credentials";
  decoding?: "sync" | "async" | "auto";
  loading?: "eager" | "lazy";
  referrerpolicy?: ReferrerPolicy;
  fetchpriority?: "high" | "low" | "auto";
}

interface LinkAttributes extends HTMLAttributes {
  href?: string;
  rel?: string;
  type?: string;
  media?: string;
  crossorigin?: "anonymous" | "use-credentials";
  hreflang?: string;
  as?: string;
  sizes?: string;
  integrity?: string;
  fetchpriority?: "high" | "low" | "auto";
  referrerpolicy?: ReferrerPolicy;
}

interface MetaAttributes extends HTMLAttributes {
  name?: string;
  content?: string;
  charset?: string;
  "http-equiv"?: string;
  property?: string;
}

interface ScriptAttributes extends HTMLAttributes {
  src?: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
  crossorigin?: "anonymous" | "use-credentials";
  integrity?: string;
  nonce?: string;
  nomodule?: boolean;
  referrerpolicy?: ReferrerPolicy;
  fetchpriority?: "high" | "low" | "auto";
}

interface StyleAttributes extends HTMLAttributes {
  media?: string;
  nonce?: string;
}

interface TableAttributes extends HTMLAttributes {
  cellpadding?: number | string;
  cellspacing?: number | string;
  summary?: string;
}

interface TdAttributes extends HTMLAttributes {
  colspan?: number;
  rowspan?: number;
  headers?: string;
  abbr?: string;
  scope?: "col" | "row" | "colgroup" | "rowgroup";
}

interface ThAttributes extends TdAttributes {
  scope?: "col" | "row" | "colgroup" | "rowgroup";
}

interface ColAttributes extends HTMLAttributes {
  span?: number;
}

interface FieldsetAttributes extends HTMLAttributes {
  disabled?: boolean;
  name?: string;
  form?: string;
}

interface LegendAttributes extends HTMLAttributes {}

interface DetailsAttributes extends HTMLAttributes {
  open?: boolean;
  name?: string;
}

interface DialogAttributes extends HTMLAttributes {
  open?: boolean;
}

interface IframeAttributes extends HTMLAttributes {
  src?: string;
  srcdoc?: string;
  name?: string;
  sandbox?: string;
  allow?: string;
  allowfullscreen?: boolean;
  width?: number | string;
  height?: number | string;
  loading?: "eager" | "lazy";
  referrerpolicy?: ReferrerPolicy;
}

interface HtmlRootAttributes extends HTMLAttributes {
  xmlns?: string;
}

interface HrAttributes extends HTMLAttributes {}

interface OlAttributes extends HTMLAttributes {
  reversed?: boolean;
  start?: number;
  type?: "1" | "a" | "A" | "i" | "I";
}

interface LiAttributes extends HTMLAttributes {
  value?: number;
}

interface ProgressAttributes extends HTMLAttributes {
  value?: number;
  max?: number;
}

interface MeterAttributes extends HTMLAttributes {
  value?: number;
  min?: number;
  max?: number;
  low?: number;
  high?: number;
  optimum?: number;
}

interface TimeAttributes extends HTMLAttributes {
  datetime?: string;
}

interface TrackAttributes extends HTMLAttributes {
  kind?: "subtitles" | "captions" | "descriptions" | "chapters" | "metadata";
  src?: string;
  srclang?: string;
  label?: string;
  default?: boolean;
}

interface VideoAttributes extends HTMLAttributes {
  src?: string;
  poster?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: "none" | "metadata" | "auto";
  width?: number | string;
  height?: number | string;
  crossorigin?: "anonymous" | "use-credentials";
  playsinline?: boolean;
}

interface AudioAttributes extends HTMLAttributes {
  src?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: "none" | "metadata" | "auto";
  crossorigin?: "anonymous" | "use-credentials";
}

interface SourceAttributes extends HTMLAttributes {
  src?: string;
  srcset?: string;
  type?: string;
  sizes?: string;
  media?: string;
}

interface MapAttributes extends HTMLAttributes {
  name?: string;
}

interface AreaAttributes extends HTMLAttributes {
  shape?: "rect" | "circle" | "poly" | "default";
  coords?: string;
  href?: string;
  alt?: string;
  target?: string;
  rel?: string;
  download?: string;
}

interface BaseAttributes extends HTMLAttributes {
  href?: string;
  target?: string;
}

// ---------------------------------------------------------------------------
// SVG attributes
// ---------------------------------------------------------------------------

interface SVGAttributes extends HtmxAttributes {
  id?: string;
  class?: string;
  style?: string | Record<string, string | number>;
  children?: JSXNode;
  key?: unknown;
  // `| undefined` on these lets SVG primitives (e.g. Icon) render attributes inline as
  // `width={maybe}` / `aria-label={maybe}` — keeping them statically visible to a11y lint —
  // while satisfying `exactOptionalPropertyTypes` when the value resolves to undefined.
  width?: number | string | undefined;
  height?: number | string | undefined;
  viewBox?: string | undefined;
  fill?: string;
  stroke?: string | undefined;
  "stroke-width"?: number | string | undefined;
  "stroke-linecap"?: string | undefined;
  "stroke-linejoin"?: string | undefined;
  xmlns?: string;
  "xmlns:xlink"?: string;
  "aria-hidden"?: string | boolean | undefined;
  "aria-label"?: string | undefined;
  role?: string;
  focusable?: boolean | "false" | "true";
  [key: `data-${string}`]: unknown;
}

interface SVGPathAttributes extends SVGAttributes {
  d?: string;
  "fill-rule"?: "nonzero" | "evenodd" | "inherit";
  "clip-rule"?: "nonzero" | "evenodd" | "inherit";
  "stroke-dasharray"?: string;
  "stroke-dashoffset"?: string | number;
  opacity?: number | string;
}

interface SVGCircleAttributes extends SVGAttributes {
  cx?: number | string;
  cy?: number | string;
  r?: number | string;
}

interface SVGRectAttributes extends SVGAttributes {
  x?: number | string;
  y?: number | string;
  rx?: number | string;
  ry?: number | string;
}

interface SVGLineAttributes extends SVGAttributes {
  x1?: number | string;
  y1?: number | string;
  x2?: number | string;
  y2?: number | string;
}

interface SVGUseAttributes extends SVGAttributes {
  href?: string;
  "xlink:href"?: string;
  x?: number | string;
  y?: number | string;
}

interface SVGSymbolAttributes extends SVGAttributes {
  preserveAspectRatio?: string;
}

interface SVGLinearGradientAttributes extends SVGAttributes {
  x1?: number | string;
  y1?: number | string;
  x2?: number | string;
  y2?: number | string;
  gradientUnits?: "userSpaceOnUse" | "objectBoundingBox";
  gradientTransform?: string;
}

interface SVGRadialGradientAttributes extends SVGAttributes {
  cx?: number | string;
  cy?: number | string;
  r?: number | string;
  fx?: number | string;
  fy?: number | string;
  gradientUnits?: "userSpaceOnUse" | "objectBoundingBox";
}

interface SVGStopAttributes extends SVGAttributes {
  offset?: number | string;
  "stop-color"?: string;
  "stop-opacity"?: number | string;
}

interface SVGTextAttributes extends SVGAttributes {
  x?: number | string;
  y?: number | string;
  "text-anchor"?: "start" | "middle" | "end" | "inherit";
  "font-size"?: number | string;
  "font-family"?: string;
  "font-weight"?: "normal" | "bold" | "bolder" | "lighter" | (string & {});
}

interface SVGClipPathAttributes extends SVGAttributes {
  clipPathUnits?: "userSpaceOnUse" | "objectBoundingBox";
}

interface SVGMaskAttributes extends SVGAttributes {
  maskUnits?: "userSpaceOnUse" | "objectBoundingBox";
  maskContentUnits?: "userSpaceOnUse" | "objectBoundingBox";
  x?: number | string;
  y?: number | string;
}

interface SVGPatternAttributes extends SVGAttributes {
  patternUnits?: "userSpaceOnUse" | "objectBoundingBox";
  patternTransform?: string;
  x?: number | string;
  y?: number | string;
}

interface SVGFilterAttributes extends SVGAttributes {
  filterUnits?: "userSpaceOnUse" | "objectBoundingBox";
  x?: number | string;
  y?: number | string;
  primitiveUnits?: "userSpaceOnUse" | "objectBoundingBox";
}

// ---------------------------------------------------------------------------
// JSX namespace — must be named exactly `JSX` for the TypeScript transform
// ---------------------------------------------------------------------------

export declare namespace JSX {
  type Element = JSXElement;

  interface ElementChildrenAttribute {
    // biome-ignore lint/complexity/noBannedTypes: TypeScript JSX convention — {} is required by the spec to declare the children slot
    children: {};
  }

  interface ElementAttributesProperty {
    // biome-ignore lint/complexity/noBannedTypes: TypeScript JSX convention — {} is required by the spec to declare the props slot
    props: {};
  }

  /** Allows `key` on any JSX element without it being an excess property. */
  interface IntrinsicAttributes {
    key?: unknown;
  }

  interface IntrinsicElements {
    // Root
    html: HtmlRootAttributes;
    head: HTMLAttributes;
    body: HTMLAttributes;

    // Metadata
    title: HTMLAttributes;
    base: BaseAttributes;
    link: LinkAttributes;
    meta: MetaAttributes;
    style: StyleAttributes;
    script: ScriptAttributes;

    // Sectioning
    article: HTMLAttributes;
    aside: HTMLAttributes;
    footer: HTMLAttributes;
    header: HTMLAttributes;
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    h4: HTMLAttributes;
    h5: HTMLAttributes;
    h6: HTMLAttributes;
    hgroup: HTMLAttributes;
    main: HTMLAttributes;
    nav: HTMLAttributes;
    section: HTMLAttributes;
    search: HTMLAttributes;

    // Grouping
    blockquote: HTMLAttributes;
    dd: HTMLAttributes;
    div: HTMLAttributes;
    dl: HTMLAttributes;
    dt: HTMLAttributes;
    figcaption: HTMLAttributes;
    figure: HTMLAttributes;
    hr: HrAttributes;
    li: LiAttributes;
    menu: HTMLAttributes;
    ol: OlAttributes;
    p: HTMLAttributes;
    pre: HTMLAttributes;
    ul: HTMLAttributes;

    // Text
    a: AnchorAttributes;
    abbr: HTMLAttributes;
    b: HTMLAttributes;
    bdi: HTMLAttributes;
    bdo: HTMLAttributes;
    br: HTMLAttributes;
    cite: HTMLAttributes;
    code: HTMLAttributes;
    data: HTMLAttributes;
    dfn: HTMLAttributes;
    em: HTMLAttributes;
    i: HTMLAttributes;
    kbd: HTMLAttributes;
    mark: HTMLAttributes;
    q: HTMLAttributes;
    rp: HTMLAttributes;
    rt: HTMLAttributes;
    ruby: HTMLAttributes;
    s: HTMLAttributes;
    samp: HTMLAttributes;
    small: HTMLAttributes;
    span: HTMLAttributes;
    strong: HTMLAttributes;
    sub: HTMLAttributes;
    sup: HTMLAttributes;
    time: TimeAttributes;
    u: HTMLAttributes;
    var: HTMLAttributes;
    wbr: HTMLAttributes;

    // Embedded
    area: AreaAttributes;
    audio: AudioAttributes;
    img: ImgAttributes;
    map: MapAttributes;
    track: TrackAttributes;
    video: VideoAttributes;

    // Scripting
    canvas: HTMLAttributes;
    noscript: HTMLAttributes;

    // Interactive
    details: DetailsAttributes;
    dialog: DialogAttributes;
    summary: HTMLAttributes;

    // Forms
    button: ButtonAttributes;
    datalist: HTMLAttributes;
    fieldset: FieldsetAttributes;
    form: FormAttributes;
    input: InputAttributes;
    label: LabelAttributes;
    legend: LegendAttributes;
    meter: MeterAttributes;
    optgroup: OptgroupAttributes;
    option: OptionAttributes;
    output: HTMLAttributes;
    progress: ProgressAttributes;
    select: SelectAttributes;
    textarea: TextareaAttributes;

    // Tables
    caption: HTMLAttributes;
    col: ColAttributes;
    colgroup: ColAttributes;
    table: TableAttributes;
    tbody: HTMLAttributes;
    td: TdAttributes;
    tfoot: HTMLAttributes;
    th: ThAttributes;
    thead: HTMLAttributes;
    tr: HTMLAttributes;

    // Web Components
    slot: HTMLAttributes;
    template: HTMLAttributes;

    // Iframes / Embedded objects
    iframe: IframeAttributes;
    embed: HTMLAttributes;
    object: HTMLAttributes;
    source: SourceAttributes;
    param: HTMLAttributes;

    // SVG
    svg: SVGAttributes;
    path: SVGPathAttributes;
    circle: SVGCircleAttributes;
    ellipse: SVGAttributes;
    line: SVGLineAttributes;
    polygon: SVGAttributes;
    polyline: SVGAttributes;
    rect: SVGRectAttributes;
    use: SVGUseAttributes;
    symbol: SVGSymbolAttributes;
    defs: SVGAttributes;
    g: SVGAttributes;
    text: SVGTextAttributes;
    tspan: SVGTextAttributes;
    textPath: SVGTextAttributes;
    linearGradient: SVGLinearGradientAttributes;
    radialGradient: SVGRadialGradientAttributes;
    stop: SVGStopAttributes;
    clipPath: SVGClipPathAttributes;
    mask: SVGMaskAttributes;
    pattern: SVGPatternAttributes;
    filter: SVGFilterAttributes;
    feBlend: SVGAttributes;
    feColorMatrix: SVGAttributes;
    feComposite: SVGAttributes;
    feFlood: SVGAttributes;
    feGaussianBlur: SVGAttributes;
    feMerge: SVGAttributes;
    feMergeNode: SVGAttributes;
    feOffset: SVGAttributes;
    feTurbulence: SVGAttributes;
    image: SVGAttributes;
    marker: SVGAttributes;
    foreignObject: SVGAttributes;
    desc: SVGAttributes;
    metadata: SVGAttributes;
    animate: SVGAttributes;
    animateMotion: SVGAttributes;
    animateTransform: SVGAttributes;
    mpath: SVGAttributes;
    set: SVGAttributes;
  }
}
