import type { AppContext } from "../../context/types";
import type { TurnstileFailure } from "../../form/types";
import type { DialValues } from "../contracts/theme/types";
import type { ForgeIcon } from "../core/types";
import type { showcaseRoutes } from "./register";
import type { APPEARANCES } from "./turnstile-demo";
import type { CHALLENGES } from "./turnstile-demo";
import type { LANGUAGES } from "./turnstile-demo";
import type { LOADS } from "./turnstile-demo";
import type { SIZES } from "./turnstile-demo";

/** The showcase's bound sprite. Named once because a dozen section signatures take it. @internal */
export type ShowIcon = ForgeIcon<
  | "spinner"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "sun"
  | "moon"
  | "monitor"
  | "hamburger"
  | "close"
  | "panel-open"
  | "panel-close"
  | "upload"
>;

/** The route a catalog entry is served on — pages are cut by what a consumer must wire up. */
export type ShowcasePage = "index" | "interactive" | "runtime" | "htmx" | "turnstile" | "chrome";

/** A job this band's component is not the answer to, and the catalog id of the one that is. @internal */
export interface CatalogAlternative {
  /** The other component's own job, in the corpus's words. */
  when: string;
  /** Its catalog id — the label and the page are read from `SECTIONS`. */
  id: string;
}

/** One coverage key the catalog does not yet demonstrate, and the task that owes it. @internal */
export interface CoverageGap {
  /** The demo or axis key, as the coverage manifest spells it. */
  key: string;
  /** The ledger task that closes it. Mandatory and non-empty. */
  owner: string;
}

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

/** The glyphs the demonstration band draws — the customiser itself needs none. @public */
export type CustomiseIcon = ForgeIcon<"spinner" | "chevron-down">;

/** Data returned by {@link loadCustomise}. @public */
export interface CustomiseData {
  /** Every dial's value, already clamped and snapped. Keyed by `Dial.field`. */
  dials: DialValues;
  path: string;
}

/** Icon constraint covering all showcase sections — pass your app's icon component. @public */
export type ShowcaseIcon = ForgeIcon<
  | "spinner"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "sun"
  | "moon"
  | "monitor"
  | "hamburger"
  | "close"
  | "panel-open"
  | "panel-close"
  | "upload"
>;

/** The `ui` subtree returned by `showcaseRoutes` — pass this to `registerShowcase`. @public */
export type ShowcaseUiRoutes = ReturnType<typeof showcaseRoutes>["ui"];

/** Options for `registerShowcase`. @public */
export interface ShowcaseOptions<Bindings extends object, Config> {
  /** Icon component used across preview, dependent, and content sections. */
  icon: ShowcaseIcon;
  /** Siteverify secret for the Turnstile page's verification panel; without it nothing is sent to Cloudflare. */
  turnstileSecret?: (c: AppContext<Bindings>, config: Config) => string | Promise<string>;
}

/** URL paths for the showcase module — single source of truth so page and controller never drift. @public */
export interface ShowcasePaths {
  page: string;
  preview: string;
  validate: string;
  search: string;
  paginate: string;
  dependent: string;
  toast: string;
  avatar: string;
  turnstile: string;
  turnstileVerify: string;
}

/** Data returned by `loadShowcase`. @public */
export interface ShowcaseData {
  paths: ShowcasePaths;
  turnstile: TurnstileDemoOptions;
}

/** @public */
export interface PreviewData {
  tone: string;
  appearance: string;
  size: string;
}

/** @public */
export interface ValidateData {
  email: string;
  paths: ShowcasePaths;
}

/** @public */
export interface SearchData {
  q: string;
}

/** @public */
export interface PaginateData {
  page: number;
  paths: ShowcasePaths;
}

/** @public */
export interface DependentData {
  category: string;
}

/** @public */
export interface ToastData {
  type: string;
}

/** One of Cloudflare's published dummy sitekeys, which is all this page ever renders. @public */
export interface TurnstileTestKey {
  id: string;
  siteKey: string;
  label: string;
  note: string;
}

/** Every prop the playground drives, read from the query string. @public */
export interface TurnstileDemoOptions {
  key: string;
  size: (typeof SIZES)[number];
  load: (typeof LOADS)[number];
  challenge: (typeof CHALLENGES)[number];
  appearance: (typeof APPEARANCES)[number];
  action: string;
  cData: string;
  responseFieldName: string;
  language: (typeof LANGUAGES)[number];
  tabindex: number | null;
}

/** How the verify round trip ended: the pipeline's own verdict, not the widget's. @public */
export type TurnstileVerdict = { kind: "verified" } | { kind: "rejected"; guard: string; reason: TurnstileFailure } | { kind: "unconfigured" };
