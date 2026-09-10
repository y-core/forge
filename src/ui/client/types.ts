/** Options for {@link bindText}. */
export interface BindTextOptions {
  /** Renders a signal's value as the text to write. @default String */
  format?: (value: unknown) => string;
}

export interface MountOptions {
  /** Modules to publish on `window`, keyed by global name. Values are specifiers resolved from
   * `src/` — e.g. `{ forgeResume: "./ui/client/resume" }`. */
  expose?: Record<string, string>;
  /**
   * Stylesheets to load into the page, as paths resolved from `src/`.
   *
   * Served raw, with no Tailwind build: name each sheet the spec needs in `forge.css`'s import
   * order (a relative `@import` will not resolve through `addStyleTag`), and size fixtures by
   * content or inline `<style>` rather than by a utility class, which resolves to nothing.
   */
  css?: string[];
  /**
   * The origin the fixture is served from, defaulting to {@link ORIGIN}.
   *
   * Only a spec needing a *secure* context has cause to change it: `http://forge.test/` is not one,
   * so Chromium exposes no `PublicKeyCredential` and no `navigator.credentials` there at all. Pass
   * `SECURE_ORIGIN` for a spec that drives WebAuthn.
   */
  origin?: string;
}

/** Options for {@link mountCarouselDots}. @public */
export interface CarouselDotsOptions {
  /** The `Carousel.Dots` nav whose anchors point at the slides. */
  root: Element;
  /** Selector for the dots to drive. */
  dotSelector?: string;
}

/** Options for {@link mountRovingFocus}. @public */
export interface RovingFocusOptions {
  /** Selector for the composite's items, resolved **live** against `root` on every interaction. */
  items: string;
  /** Which arrows navigate. `both` claims all four. @default "horizontal" */
  orientation?: "horizontal" | "vertical" | "both";
  /** Wrap from the last item to the first and back. @default true */
  loop?: boolean;
  /** Jump to an item by typing the start of its text. @default false */
  typeahead?: boolean;
  /** Idle time before the typeahead buffer resets. @default 500 */
  typeaheadTimeout?: number;
}

/** Options for {@link mountNavDrawer}. @public */
export interface NavDrawerOptions {
  /** The disclosure to drive — a `<details>`. Takes precedence over {@link NavDrawerOptions.selector}. */
  element?: Element | null;
  /** Selector for the disclosure, resolved in {@link NavDrawerOptions.within}'s document.
   *  Ignored when an element is given. */
  selector?: string;
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
  /** Media query that, for as long as it matches, makes the open disclosure a modal drawer. */
  query?: string;
  /** Selector for the sliding panel inside the disclosure. */
  panelSelector?: string;
}

/** One fragment link and the element it points at. @internal */
export interface FragmentEntry {
  link: Element;
  target: Element;
}

/** What a controller does once the guards have passed: watch these boxes, this way. @internal */
export interface FragmentObserverPlan {
  init: IntersectionObserverInit;
  onRecords(records: readonly IntersectionObserverEntry[]): void;
  /** Teardown beyond disconnecting, run before the mount record is dropped. */
  cleanup?(): void;
}

/** What {@link mountFragmentObserver} needs to stand one controller up. @internal */
export interface FragmentObserverConfig {
  root: Element;
  selector: string;
  /** The mounting function's own name, for the `root` error. */
  fn: string;
  /** The log prefix, and what the caller should have passed as `root`. */
  label: string;
  requires: string;
  /** What is lost when the guard trips, completing "…; <degraded>". */
  emptyTarget: string;
  degraded: string;
  mounted: WeakMap<Element, () => void>;
  /** Returns the plan, or `null` after warning about markup it cannot drive. */
  plan(entries: FragmentEntry[]): FragmentObserverPlan | null;
}

export interface LazyImportOptions<T> {
  ref: string;
  load: () => Promise<T>;
  init: (mod: T, el: Element) => void;
  rootMargin?: string;
  threshold?: number | number[];
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
  /** Invoked when `load()` rejects and when `init` throws. */
  onError?: (error: unknown) => void;
}

/** Options for {@link mountMenu}. */
export interface MenuOptions {
  /** Wrap from the last item to the first. @default true */
  loop?: boolean;
}

/** Options for {@link openPopoverAt}. */
export interface OpenPopoverAtOptions {
  /** Keep this many pixels between the popup and each viewport edge. @default 0 */
  margin?: number;
  /** Open away from the point on an axis where the popup would not fit, instead of clamping it back on screen. @default false */
  flip?: boolean;
  /** Hold the show back until the pointer button currently held down is released. @default false */
  afterPointerUp?: boolean;
}

/** Context handed to a scope's `setup` and action handlers. @public */
export interface ResumeContext {
  /** The `[data-scope]` element enclosing the interaction. */
  root: HTMLElement;
  /** The element that fired the event (carries the `data-on-<event>` action). */
  el: HTMLElement;
  /** State rebuilt from `data-island-state` into reactive signals. */
  state: Record<string, Signal<unknown>>;
}

/** A registered scope: one-time setup plus a map of named action handlers. @public */
export interface ScopeDefinition<A extends string = string> {
  /** Resume at `resume()` time instead of waiting for the first interaction. */
  eager?: boolean;
  /** Binds DOM-mutating effects once on first resume, optionally returning a disposer. */
  // oxlint-disable-next-line typescript/no-invalid-void-type -- void in union is intentional — allows implicit-return setups
  setup?: (ctx: Omit<ResumeContext, "el">) => void | (() => void);
  /** Action handlers keyed by the `data-on-<event>` value. */
  on?: Record<A, (ctx: ResumeContext, event: Event) => void>;
}

/** Options for {@link mountScrollSpy}. @public */
export interface ScrollSpyOptions {
  /** The nav subtree holding the fragment links. */
  root: Element;
  /** Selector for the links to spy on. */
  linkSelector?: string;
  /** `rootMargin` for the observer — the default biases toward the section at the top of the
   *  viewport rather than the one merely visible. */
  rootMargin?: string;
}

/** Maps a plain state object to one signal per key. @public */
export type SignalRecord<T> = { [K in keyof T]: Signal<T[K]> };

/** A readable and writable reactive value; reading `.value` inside an effect subscribes to it. @public */
export interface Signal<T> {
  get value(): T;
  set value(v: T);
}

/** A signal exposing only its read side, as returned by `computed`. @public */
export interface ReadonlySignal<T> {
  get value(): T;
}

/** What `withOwner` returns: the callback's value, and a disposer for the effects it created. */
export interface OwnedRun<T> {
  result: T;
  dispose: () => void;
}

export interface TabsOptions {
  /** Select a tab as soon as focus reaches it. @default read from the root's `data-activation` */
  activation?: "automatic" | "manual";
}

/** One recorded `fetch`, with the body already parsed back from JSON where it was JSON. */
export interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface TooltipOptions {
  /** @default 400 */
  showDelayMs?: number;
  /** @default 100 */
  hideDelayMs?: number;
}

/** Options for {@link mountViewportCollapse}. @public */
export interface ViewportCollapseOptions {
  /** The disclosure to drive — a `<details>`. Takes precedence over {@link ViewportCollapseOptions.selector}. */
  element?: Element | null;
  /** Selector for the disclosure, resolved in {@link ViewportCollapseOptions.within}'s document.
   *  Ignored when an element is given. */
  selector?: string;
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
  /** Media query that, for as long as it matches, keeps the disclosure collapsed. */
  query?: string;
}
