import type { FindingLevel } from "../finding";
import type { RuleId } from "./design-parse";

/** A modern-platform CSS rule this check enforces. @public */
export type ModernCssRuleId =
  | "forge-ui-platform-aspect-ratio"
  | "forge-ui-platform-centering"
  | "forge-ui-platform-image-set"
  | "forge-ui-platform-isolation"
  | "forge-ui-platform-light-dark"
  | "forge-ui-platform-line-clamp"
  | "forge-ui-platform-logical-spacing"
  | "forge-ui-platform-scrollbar"
  | "forge-ui-platform-native-dialog"
  | "forge-ui-platform-native-popover"
  | "forge-ui-platform-native-details"
  | "forge-ui-platform-entry-motion"
  | "forge-ui-platform-parent-state"
  | "forge-ui-platform-inert"
  | "forge-ui-platform-theme-detection"
  | "forge-ui-platform-smooth-scroll"
  | "forge-ui-platform-ticker"
  | "forge-ui-platform-counters"
  | "forge-ui-platform-count-up"
  | "forge-ui-platform-animated-border"
  | "forge-ui-platform-motion-path"
  | "forge-ui-platform-reveal-mask"
  | "forge-ui-platform-scroll-reveal"
  | "forge-ui-platform-carousel"
  | "forge-ui-platform-field-sizing"
  | "forge-ui-platform-anchor-positioning"
  | "forge-ui-platform-layer"
  | "forge-ui-platform-nesting"
  | "forge-ui-platform-container-query"
  | "forge-ui-platform-subgrid"
  | "forge-ui-platform-selector-list"
  | "forge-ui-platform-accent-color"
  | "forge-ui-platform-view-transition"
  | "forge-ui-platform-text-balance"
  | "forge-ui-platform-text-pretty"
  | "forge-ui-platform-field-sizing-adopt"
  | "forge-ui-platform-interpolate-size"
  | "forge-ui-platform-scope"
  | "forge-ui-platform-display-contents"
  | "forge-ui-platform-color-mix";

// `UI_DESIGN_GUIDANCE.md` §3b makes a rule id permanent and corpus-unique, so a pattern the corpus
// already names is reported under the id it already has rather than under a second one here.
/** Rule ids the design corpus owns, which this check reports under rather than minting again. @public */
export type ModernCssCitedRuleId = Extract<RuleId, "forge-ui-viewport-units" | "forge-ui-interaction-focus-visible"> | "forge-ui-reduced-motion";

/** Any id this check reports a finding under. @public */
export type ModernCssReportedId = ModernCssRuleId | ModernCssCitedRuleId;

/** How a rule is detected: `A` is textual, `B` and `C` need rendered behaviour. @public */
export type ModernCssTier = "A" | "B" | "C";

/** What the check knows about one rule beyond how to detect it. @public */
export interface ModernCssRule {
  tier: ModernCssTier;
  severity: FindingLevel;
  /** The corpus file that states the rule. */
  corpus: string;
  /** The platform feature that replaces the pattern. */
  replacement: string;
  /** What has to be confirmed by hand before taking the replacement. */
  verify: string;
}

const CORPUS = "src/ui/design/reference/16-platform.md";

const FLOOR = "src/ui/design/floor.md";

/** Every rule this check enforces, keyed by id. @public */
export const MODERN_CSS_RULES: Readonly<Record<ModernCssRuleId, ModernCssRule>> = {
  "forge-ui-platform-aspect-ratio": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "aspect-ratio",
    verify: "the percentage resolves against the inline size, so a ratio taken from a block-size padding is not the same box",
  },
  "forge-ui-platform-centering": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "place-items: center",
    verify: "the replacement moves the rule onto the container, so a child positioned against a different containing block changes box",
  },
  "forge-ui-platform-image-set": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "image-set()",
    verify: "a density query may also be switching art direction, which image-set() does not express",
  },
  "forge-ui-platform-isolation": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "isolation: isolate",
    verify: "the negative layer may be deliberately painting behind an ancestor's background rather than behind a sibling",
  },
  "forge-ui-platform-light-dark": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "light-dark()",
    verify: "light-dark() reads color-scheme, so the element must sit under a declared scheme rather than the media query's",
  },
  "forge-ui-platform-line-clamp": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "line-clamp",
    verify: "the prefixed form needs display: -webkit-box, which the standard property does not, so the box type changes with it",
  },
  "forge-ui-platform-logical-spacing": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "the logical property or utility on the same axis",
    verify: "a rule that is physical on purpose — anchored placement, a mirrored glyph — states so rather than being rewritten",
  },
  "forge-ui-platform-scrollbar": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "scrollbar-color and scrollbar-width",
    verify: "the standard properties style the scrollbar but cannot size or shape its parts the way the pseudo-elements did",
  },
  "forge-ui-platform-native-dialog": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "<dialog> opened with showModal()",
    verify: "showModal() puts the element in the top layer and makes the rest of the page inert, which a positioned div was not doing",
  },
  "forge-ui-platform-native-popover": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "the Popover API",
    verify: "a popover light-dismisses on outside click and Escape, so a panel that must survive either one is not one",
  },
  "forge-ui-platform-native-details": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "<details> and <summary>",
    verify:
      "a closed <details> hides its content from find-in-page only until the browser expands it, which changes what a scripted panel guaranteed",
  },
  "forge-ui-platform-entry-motion": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@starting-style with transition-behavior: allow-discrete",
    verify: "the starting style applies on the first style change after insertion, so an element already in the DOM never enters",
  },
  "forge-ui-platform-parent-state": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: ":has()",
    verify: ":has() re-evaluates on every state change, so a class the script only set once becomes live",
  },
  "forge-ui-platform-inert": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "the inert attribute",
    verify: "inert removes the subtree from the accessibility tree as well as from the tab order, which a tabindex sweep did not",
  },
  "forge-ui-platform-theme-detection": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "light-dark()",
    verify: "light-dark() follows color-scheme, so a theme the app drives from a class rather than the media query needs the script",
  },
  "forge-ui-platform-smooth-scroll": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "scroll-behavior with scroll-margin",
    verify: "scroll-behavior is honoured for user-initiated scrolls too, which a per-call option was not",
  },
  "forge-ui-platform-ticker": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "keyframes gated on prefers-reduced-motion",
    verify: "keyframes run off the main thread and cannot read a value the interval was recomputing each tick",
  },
  "forge-ui-platform-counters": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "CSS counters",
    verify: "generated content is not in the DOM, so a number that has to be copied or read by a script stays in text",
  },
  "forge-ui-platform-count-up": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@property with counters",
    verify:
      "a registered custom property interpolates as a number but renders through content, which no assistive technology announces mid-animation",
  },
  "forge-ui-platform-animated-border": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@property with conic-gradient()",
    verify: "registering the angle makes it animatable, and the gradient then repaints without a frame callback",
  },
  "forge-ui-platform-motion-path": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "offset-path",
    verify: "offset-path also rotates the element along the path unless offset-rotate says otherwise",
  },
  "forge-ui-platform-reveal-mask": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "a CSS mask driven by one custom property",
    verify: "a mask composites the whole element, so a child that was outside the scripted clip is now masked too",
  },
  "forge-ui-platform-scroll-reveal": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "animation-timeline: view()",
    verify: "a view timeline re-runs as the element scrolls back out, where a one-shot observer did not",
  },
  "forge-ui-platform-carousel": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "scroll snap with ::scroll-button()",
    verify: "scroll snap steps by snap position rather than by index, so a track with uneven slides pages differently",
  },
  "forge-ui-platform-field-sizing": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "field-sizing: content",
    verify: "the control now grows without bound unless a max-block-size caps it, which the scripted height implicitly did",
  },
  "forge-ui-platform-anchor-positioning": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "anchor()",
    verify: "anchor() needs the anchor and the positioned element in the same anchor scope, which a measured rectangle did not require",
  },
  "forge-ui-platform-layer": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@layer",
    verify: "an unlayered rule beats every layered one, so moving only part of a stylesheet into a layer inverts the order it had",
  },
  "forge-ui-platform-nesting": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "native CSS nesting",
    verify: "native nesting resolves a bare element selector differently from the preprocessor, which needed no & before a type",
  },
  "forge-ui-platform-container-query": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@container",
    verify: "a container query needs an ancestor declaring container-type, which establishes containment and can change that ancestor's own sizing",
  },
  "forge-ui-platform-subgrid": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "subgrid",
    verify: "subgrid inherits the parent's tracks, so a child that was sized independently now stretches to the parent's",
  },
  "forge-ui-platform-selector-list": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: ":is() or :where()",
    verify: ":is() takes the specificity of its most specific argument and :where() takes none, so neither matches the list's own specificity",
  },
  "forge-ui-platform-accent-color": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "accent-color",
    verify: "accent-color tints the native control and cannot change its shape, so a design that redrew the box is not expressible",
  },
  "forge-ui-platform-view-transition": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "startViewTransition()",
    verify: "a view transition freezes the page for the capture, so work started in the callback delays the frame",
  },
  "forge-ui-platform-text-balance": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "text-wrap: balance",
    verify: "balancing is capped at a few lines, so it silently does nothing on a heading that wraps past the limit",
  },
  "forge-ui-platform-text-pretty": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "text-wrap: pretty",
    verify: "pretty wrapping changes line breaks, so a block whose height was measured for a fixed box may now take another line",
  },
  "forge-ui-platform-field-sizing-adopt": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "field-sizing: content",
    verify: "the control grows without bound unless a max-block-size caps it, and the rows attribute stops being the height",
  },
  "forge-ui-platform-interpolate-size": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "interpolate-size: allow-keywords",
    verify: "the keyword is allowed from the declaring element down, so a transition on an ancestor's descendant needs it declared above both",
  },
  "forge-ui-platform-scope": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@scope",
    verify: "a scoped rule stops at the scope's lower boundary, so a descendant the prefix used to reach through a slot is no longer matched",
  },
  "forge-ui-platform-display-contents": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "display: contents",
    verify: "the box disappears with its background, border and any transform, and until recently took its accessibility role with it",
  },
  "forge-ui-platform-color-mix": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "color-mix()",
    verify: "a mix with transparent composites against whatever is behind it, so a derived token carrying a contrast floor is not one",
  },
};

/** The rules this check reports under an id the design corpus already owns. @public */
export const MODERN_CSS_CITED_RULES: Readonly<Record<ModernCssCitedRuleId, ModernCssRule>> = {
  "forge-ui-viewport-units": {
    tier: "C",
    severity: "warn",
    corpus: FLOOR,
    replacement: "the dynamic viewport units",
    verify: "the dynamic units change as the mobile toolbars retract, so a box sized from one moves where the static unit did not",
  },
  "forge-ui-interaction-focus-visible": {
    tier: "C",
    severity: "warn",
    corpus: "src/ui/design/reference/09-interaction.md",
    replacement: ":focus-visible",
    verify: "a control reachable only by pointer never matches :focus-visible, so it would lose its indicator entirely",
  },
  "forge-ui-reduced-motion": {
    tier: "C",
    severity: "warn",
    corpus: FLOOR,
    replacement: "the motion-safe: and motion-reduce: variants",
    verify: "a transition that only conveys state, rather than motion, may be the accessible form already",
  },
};

const REPORTED: Readonly<Record<ModernCssReportedId, ModernCssRule>> = { ...MODERN_CSS_RULES, ...MODERN_CSS_CITED_RULES };

/** The rule behind any id this check reports, minted here or cited from the corpus. @public */
export function modernCssRule(id: ModernCssReportedId): ModernCssRule {
  return REPORTED[id];
}
