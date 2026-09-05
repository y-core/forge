import type { SafeHtml } from "../http/html";

/** A node in the forge SSR JSX tree. @public */
export type JSXNode = JSXElement | SafeHtml | string | number | boolean | null | undefined | JSXNode[];

/** Component function — accepts any props object, returns a (possibly async) node. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- JSX runtime must accept any component signature at the type-erasure level
export type ComponentFn = (...args: any[]) => unknown | Promise<unknown>;

// Declared here and given a value in element.ts: a symbol brand cannot be forged by JSON.parse.
declare const kJsxElement: unique symbol;

/** An element produced by the forge JSX runtime. Branded with a module-private symbol. @public */
export interface JSXElement {
  type: string | ComponentFn;
  props: Record<string, unknown>;
  key?: unknown | undefined;
  readonly [kJsxElement]: true;
}

/** Function component: receives props, returns a JSX element (or null for no output). @public */
export type FC<P = Record<string, unknown>> = (props: P & { children?: JSXNode | undefined }) => JSXElement | null;

/** @public */
export type PropsWithChildren<P = Record<string, unknown>> = P & { children?: JSXNode | undefined };

interface AriaAttributes {
  role?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-expanded"?: boolean | "true" | "false" | undefined;
  "aria-controls"?: string | undefined;
  "aria-haspopup"?: boolean | "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined;
  "aria-hidden"?: boolean | "true" | "false" | undefined;
  "aria-live"?: "off" | "assertive" | "polite" | undefined;
  "aria-atomic"?: boolean | "true" | "false" | undefined;
  "aria-required"?: boolean | "true" | "false" | undefined;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" | undefined;
  "aria-selected"?: boolean | "true" | "false" | undefined;
  "aria-checked"?: boolean | "true" | "false" | "mixed" | undefined;
  "aria-disabled"?: boolean | "true" | "false" | undefined;
  "aria-current"?: boolean | "page" | "step" | "location" | "date" | "time" | undefined;
  "aria-busy"?: boolean | "true" | "false" | undefined;
  "aria-orientation"?: "horizontal" | "vertical" | undefined;
  "aria-placeholder"?: string | undefined;
  "aria-autocomplete"?: "none" | "list" | "inline" | "both" | undefined;
  "aria-multiline"?: boolean | "true" | "false" | undefined;
  "aria-valuemin"?: number | undefined;
  "aria-valuemax"?: number | undefined;
  "aria-valuenow"?: number | undefined;
  "aria-valuetext"?: string | undefined;
  "aria-level"?: number | undefined;
  "aria-posinset"?: number | undefined;
  "aria-setsize"?: number | undefined;
  "aria-rowcount"?: number | undefined;
  "aria-rowindex"?: number | undefined;
  "aria-rowspan"?: number | undefined;
  "aria-colcount"?: number | undefined;
  "aria-colindex"?: number | undefined;
  "aria-colspan"?: number | undefined;
}

interface HtmxAttributes {
  "hx-get"?: string | undefined;
  "hx-post"?: string | undefined;
  "hx-put"?: string | undefined;
  "hx-delete"?: string | undefined;
  "hx-patch"?: string | undefined;
  "hx-trigger"?: string | undefined;
  "hx-target"?: string | undefined;
  "hx-swap"?: string | undefined;
  "hx-push-url"?: string | undefined;
  "hx-select"?: string | undefined;
  "hx-select-oob"?: string | undefined;
  "hx-include"?: string | undefined;
  "hx-encoding"?: string | undefined;
  "hx-params"?: string | undefined;
  "hx-ext"?: string | undefined;
  "hx-confirm"?: string | undefined;
  "hx-boost"?: string | undefined;
  "hx-headers"?: string | undefined;
  "hx-vals"?: string | undefined;
  "hx-indicator"?: string | undefined;
  "hx-disabled-elt"?: string | undefined;
  "hx-swap-oob"?: string | undefined;
  "hx-replace-url"?: string | undefined;
  "hx-preserve"?: string | undefined;
  "hx-request"?: string | undefined;
}

/** Attributes shared by all HTML elements. @public */
export interface HTMLAttributes extends AriaAttributes, HtmxAttributes {
  id?: string | undefined;
  class?: string | undefined;
  title?: string | undefined;
  lang?: string | undefined;
  dir?: "ltr" | "rtl" | "auto" | undefined;
  hidden?: boolean | undefined;
  tabindex?: number | undefined;
  nonce?: string | undefined;
  slot?: string | undefined;
  translate?: "yes" | "no" | undefined;
  spellcheck?: boolean | undefined;
  contenteditable?: boolean | "true" | "false" | "plaintext-only" | undefined;
  draggable?: boolean | "true" | "false" | undefined;
  popover?: "" | "auto" | "manual" | "hint" | undefined;
  accesskey?: string | undefined;
  autocapitalize?: "none" | "off" | "on" | "sentences" | "words" | "characters" | undefined;
  inputmode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url" | undefined;
  enterkeyhint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined;
  children?: JSXNode | undefined;
  key?: unknown | undefined;
  [key: `data-${string}`]: unknown;
}

interface AnchorAttributes extends HTMLAttributes {
  href?: string | undefined;
  target?: "_blank" | "_self" | "_parent" | "_top" | (string & {}) | undefined;
  rel?: string | undefined;
  download?: string | boolean | undefined;
  hreflang?: string | undefined;
  ping?: string | undefined;
  referrerpolicy?: ReferrerPolicy | undefined;
  type?: string | undefined;
}

interface ButtonAttributes extends HTMLAttributes {
  type?: "button" | "submit" | "reset" | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  value?: string | number | undefined;
  form?: string | undefined;
  formaction?: string | undefined;
  formmethod?: "get" | "post" | undefined;
  formnovalidate?: boolean | undefined;
  formtarget?: string | undefined;
  autofocus?: boolean | undefined;
  popovertarget?: string | undefined;
  popovertargetaction?: "hide" | "show" | "toggle" | undefined;
  /** Invoker command activated on the `commandfor` target when the button is pressed. */
  command?: string | undefined;
  /** The id of the element this button's `command` acts on. */
  commandfor?: string | undefined;
}

interface InputAttributes extends HTMLAttributes {
  type?: string | undefined;
  name?: string | undefined;
  value?: string | number | readonly string[] | undefined;
  checked?: boolean | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  readonly?: boolean | undefined;
  placeholder?: string | undefined;
  min?: string | number | undefined;
  max?: string | number | undefined;
  step?: string | number | undefined;
  minlength?: number | undefined;
  maxlength?: number | undefined;
  pattern?: string | undefined;
  multiple?: boolean | undefined;
  accept?: string | undefined;
  autocomplete?: string | undefined;
  autofocus?: boolean | undefined;
  form?: string | undefined;
  list?: string | undefined;
  size?: number | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  src?: string | undefined;
  alt?: string | undefined;
  capture?: "user" | "environment" | undefined;
}

interface TextareaAttributes extends HTMLAttributes {
  name?: string | undefined;
  value?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  readonly?: boolean | undefined;
  placeholder?: string | undefined;
  rows?: number | undefined;
  cols?: number | undefined;
  minlength?: number | undefined;
  maxlength?: number | undefined;
  autocomplete?: string | undefined;
  autofocus?: boolean | undefined;
  form?: string | undefined;
  wrap?: "hard" | "soft" | "off" | undefined;
}

interface SelectAttributes extends HTMLAttributes {
  name?: string | undefined;
  value?: string | string[] | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  multiple?: boolean | undefined;
  size?: number | undefined;
  autocomplete?: string | undefined;
  autofocus?: boolean | undefined;
  form?: string | undefined;
}

interface OptionAttributes extends HTMLAttributes {
  value?: string | undefined;
  disabled?: boolean | undefined;
  selected?: boolean | undefined;
  label?: string | undefined;
}

interface OptgroupAttributes extends HTMLAttributes {
  label?: string | undefined;
  disabled?: boolean | undefined;
}

interface FormAttributes extends HTMLAttributes {
  action?: string | undefined;
  method?: "get" | "post" | undefined;
  enctype?: "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain" | undefined;
  novalidate?: boolean | undefined;
  target?: string | undefined;
  autocomplete?: "on" | "off" | undefined;
  name?: string | undefined;
  rel?: string | undefined;
}

interface LabelAttributes extends HTMLAttributes {
  for?: string | undefined;
  form?: string | undefined;
}

interface ImgAttributes extends HTMLAttributes {
  src?: string | undefined;
  alt?: string | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  srcset?: string | undefined;
  sizes?: string | undefined;
  crossorigin?: "anonymous" | "use-credentials" | undefined;
  decoding?: "sync" | "async" | "auto" | undefined;
  loading?: "eager" | "lazy" | undefined;
  referrerpolicy?: ReferrerPolicy | undefined;
  fetchpriority?: "high" | "low" | "auto" | undefined;
}

interface LinkAttributes extends HTMLAttributes {
  href?: string | undefined;
  rel?: string | undefined;
  type?: string | undefined;
  media?: string | undefined;
  crossorigin?: "anonymous" | "use-credentials" | undefined;
  hreflang?: string | undefined;
  as?: string | undefined;
  sizes?: string | undefined;
  integrity?: string | undefined;
  fetchpriority?: "high" | "low" | "auto" | undefined;
  referrerpolicy?: ReferrerPolicy | undefined;
}

interface MetaAttributes extends HTMLAttributes {
  name?: string | undefined;
  content?: string | undefined;
  charset?: string | undefined;
  "http-equiv"?: string | undefined;
  property?: string | undefined;
}

interface ScriptAttributes extends HTMLAttributes {
  src?: string | undefined;
  type?: string | undefined;
  async?: boolean | undefined;
  defer?: boolean | undefined;
  crossorigin?: "anonymous" | "use-credentials" | undefined;
  integrity?: string | undefined;
  nonce?: string | undefined;
  nomodule?: boolean | undefined;
  referrerpolicy?: ReferrerPolicy | undefined;
  fetchpriority?: "high" | "low" | "auto" | undefined;
}

interface StyleAttributes extends HTMLAttributes {
  media?: string | undefined;
  nonce?: string | undefined;
}

interface TableAttributes extends HTMLAttributes {
  cellpadding?: number | string | undefined;
  cellspacing?: number | string | undefined;
  summary?: string | undefined;
}

interface TdAttributes extends HTMLAttributes {
  colspan?: number | undefined;
  rowspan?: number | undefined;
  headers?: string | undefined;
  abbr?: string | undefined;
  scope?: "col" | "row" | "colgroup" | "rowgroup" | undefined;
}

interface ThAttributes extends TdAttributes {
  scope?: "col" | "row" | "colgroup" | "rowgroup" | undefined;
}

interface ColAttributes extends HTMLAttributes {
  span?: number | undefined;
}

interface FieldsetAttributes extends HTMLAttributes {
  disabled?: boolean | undefined;
  name?: string | undefined;
  form?: string | undefined;
}

interface LegendAttributes extends HTMLAttributes {}

interface DetailsAttributes extends HTMLAttributes {
  open?: boolean | undefined;
  name?: string | undefined;
}

interface DialogAttributes extends HTMLAttributes {
  open?: boolean | undefined;
  /** Which dismissal requests close the dialog; `"any"` is declarative light-dismiss. */
  closedby?: "none" | "closerequest" | "any" | undefined;
}

interface IframeAttributes extends HTMLAttributes {
  src?: string | undefined;
  srcdoc?: string | undefined;
  name?: string | undefined;
  sandbox?: string | undefined;
  allow?: string | undefined;
  allowfullscreen?: boolean | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  loading?: "eager" | "lazy" | undefined;
  referrerpolicy?: ReferrerPolicy | undefined;
}

interface HtmlRootAttributes extends HTMLAttributes {
  xmlns?: string | undefined;
}

interface HrAttributes extends HTMLAttributes {}

interface OlAttributes extends HTMLAttributes {
  reversed?: boolean | undefined;
  start?: number | undefined;
  type?: "1" | "a" | "A" | "i" | "I" | undefined;
}

interface LiAttributes extends HTMLAttributes {
  value?: number | undefined;
}

interface ProgressAttributes extends HTMLAttributes {
  value?: number | undefined;
  max?: number | undefined;
}

interface MeterAttributes extends HTMLAttributes {
  value?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  low?: number | undefined;
  high?: number | undefined;
  optimum?: number | undefined;
}

interface TimeAttributes extends HTMLAttributes {
  datetime?: string | undefined;
}

interface TrackAttributes extends HTMLAttributes {
  kind?: "subtitles" | "captions" | "descriptions" | "chapters" | "metadata" | undefined;
  src?: string | undefined;
  srclang?: string | undefined;
  label?: string | undefined;
  default?: boolean | undefined;
}

interface VideoAttributes extends HTMLAttributes {
  src?: string | undefined;
  poster?: string | undefined;
  autoplay?: boolean | undefined;
  controls?: boolean | undefined;
  loop?: boolean | undefined;
  muted?: boolean | undefined;
  preload?: "none" | "metadata" | "auto" | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  crossorigin?: "anonymous" | "use-credentials" | undefined;
  playsinline?: boolean | undefined;
}

interface AudioAttributes extends HTMLAttributes {
  src?: string | undefined;
  autoplay?: boolean | undefined;
  controls?: boolean | undefined;
  loop?: boolean | undefined;
  muted?: boolean | undefined;
  preload?: "none" | "metadata" | "auto" | undefined;
  crossorigin?: "anonymous" | "use-credentials" | undefined;
}

interface SourceAttributes extends HTMLAttributes {
  src?: string | undefined;
  srcset?: string | undefined;
  type?: string | undefined;
  sizes?: string | undefined;
  media?: string | undefined;
}

interface MapAttributes extends HTMLAttributes {
  name?: string | undefined;
}

interface AreaAttributes extends HTMLAttributes {
  shape?: "rect" | "circle" | "poly" | "default" | undefined;
  coords?: string | undefined;
  href?: string | undefined;
  alt?: string | undefined;
  target?: string | undefined;
  rel?: string | undefined;
  download?: string | undefined;
}

interface BaseAttributes extends HTMLAttributes {
  href?: string | undefined;
  target?: string | undefined;
}

interface SVGAttributes extends HtmxAttributes {
  id?: string | undefined;
  class?: string | undefined;
  children?: JSXNode | undefined;
  key?: unknown | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  viewBox?: string | undefined;
  fill?: string | undefined;
  stroke?: string | undefined;
  "stroke-width"?: number | string | undefined;
  "stroke-linecap"?: string | undefined;
  "stroke-linejoin"?: string | undefined;
  xmlns?: string | undefined;
  "xmlns:xlink"?: string | undefined;
  "aria-hidden"?: string | boolean | undefined;
  "aria-label"?: string | undefined;
  role?: string | undefined;
  focusable?: boolean | "false" | "true" | undefined;
  [key: `data-${string}`]: unknown;
}

interface SVGPathAttributes extends SVGAttributes {
  d?: string | undefined;
  "fill-rule"?: "nonzero" | "evenodd" | "inherit" | undefined;
  "clip-rule"?: "nonzero" | "evenodd" | "inherit" | undefined;
  "stroke-dasharray"?: string | undefined;
  "stroke-dashoffset"?: string | number | undefined;
  opacity?: number | string | undefined;
}

interface SVGCircleAttributes extends SVGAttributes {
  cx?: number | string | undefined;
  cy?: number | string | undefined;
  r?: number | string | undefined;
}

interface SVGRectAttributes extends SVGAttributes {
  x?: number | string | undefined;
  y?: number | string | undefined;
  rx?: number | string | undefined;
  ry?: number | string | undefined;
}

interface SVGLineAttributes extends SVGAttributes {
  x1?: number | string | undefined;
  y1?: number | string | undefined;
  x2?: number | string | undefined;
  y2?: number | string | undefined;
}

interface SVGUseAttributes extends SVGAttributes {
  href?: string | undefined;
  "xlink:href"?: string | undefined;
  x?: number | string | undefined;
  y?: number | string | undefined;
}

interface SVGSymbolAttributes extends SVGAttributes {
  preserveAspectRatio?: string | undefined;
}

interface SVGLinearGradientAttributes extends SVGAttributes {
  x1?: number | string | undefined;
  y1?: number | string | undefined;
  x2?: number | string | undefined;
  y2?: number | string | undefined;
  gradientUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
  gradientTransform?: string | undefined;
}

interface SVGRadialGradientAttributes extends SVGAttributes {
  cx?: number | string | undefined;
  cy?: number | string | undefined;
  r?: number | string | undefined;
  fx?: number | string | undefined;
  fy?: number | string | undefined;
  gradientUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
}

interface SVGStopAttributes extends SVGAttributes {
  offset?: number | string | undefined;
  "stop-color"?: string | undefined;
  "stop-opacity"?: number | string | undefined;
}

interface SVGTextAttributes extends SVGAttributes {
  x?: number | string | undefined;
  y?: number | string | undefined;
  "text-anchor"?: "start" | "middle" | "end" | "inherit" | undefined;
  "font-size"?: number | string | undefined;
  "font-family"?: string | undefined;
  "font-weight"?: "normal" | "bold" | "bolder" | "lighter" | (string & {}) | undefined;
}

interface SVGClipPathAttributes extends SVGAttributes {
  clipPathUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
}

interface SVGMaskAttributes extends SVGAttributes {
  maskUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
  maskContentUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
  x?: number | string | undefined;
  y?: number | string | undefined;
}

interface SVGPatternAttributes extends SVGAttributes {
  patternUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
  patternTransform?: string | undefined;
  x?: number | string | undefined;
  y?: number | string | undefined;
}

interface SVGFilterAttributes extends SVGAttributes {
  filterUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
  x?: number | string | undefined;
  y?: number | string | undefined;
  primitiveUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
}

// Must be named exactly `JSX`: the TypeScript transform resolves this namespace by name.
export declare namespace JSX {
  type Element = JSXElement;

  interface ElementChildrenAttribute {
    // oxlint-disable-next-line typescript/no-empty-object-type -- TypeScript JSX convention — {} is required by the spec to declare the children slot
    children: {};
  }

  interface ElementAttributesProperty {
    // oxlint-disable-next-line typescript/no-empty-object-type -- TypeScript JSX convention — {} is required by the spec to declare the props slot
    props: {};
  }

  /** Allows `key` on any JSX element without it being an excess property. */
  interface IntrinsicAttributes {
    key?: unknown | undefined;
  }

  interface IntrinsicElements {
    html: HtmlRootAttributes;
    head: HTMLAttributes;
    body: HTMLAttributes;

    title: HTMLAttributes;
    base: BaseAttributes;
    link: LinkAttributes;
    meta: MetaAttributes;
    style: StyleAttributes;
    script: ScriptAttributes;

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

    area: AreaAttributes;
    audio: AudioAttributes;
    img: ImgAttributes;
    map: MapAttributes;
    track: TrackAttributes;
    video: VideoAttributes;

    canvas: HTMLAttributes;
    noscript: HTMLAttributes;

    details: DetailsAttributes;
    dialog: DialogAttributes;
    summary: HTMLAttributes;

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

    slot: HTMLAttributes;
    template: HTMLAttributes;

    iframe: IframeAttributes;
    embed: HTMLAttributes;
    object: HTMLAttributes;
    source: SourceAttributes;
    param: HTMLAttributes;

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
