/** The resumable scope that owns the lazy demo panel. @internal */
export const LAZY_DEMO_SCOPE = "show-lazy";

/** The `data-ref` the lazy demo observes to trigger its import. @internal */
export const LAZY_DEMO_REF = "lazy-demo";

/** The `data-ref` of the line the loaded module rewrites. @internal */
export const LAZY_DEMO_STATUS_REF = "lazy-status";

/** The status line before the module arrives. @internal */
export const LAZY_DEMO_PENDING = "Not loaded yet — the module for this panel arrives when it scrolls into view.";

/** The status line the loaded module writes in its place. @internal */
export const LAZY_DEMO_LOADED = "Loaded — the module was fetched and evaluated on first sight of this panel.";

/** The `data-ref` of the anchor whose first loads reject, so the retry path is exercised. @internal */
export const LAZY_RETRY_REF = "lazy-retry-demo";

/** The `data-ref` of the line the retry anchor's attempt counter writes to. @internal */
export const LAZY_RETRY_STATUS_REF = "lazy-retry-status";

// One below `lazy()`'s own `LAZY_MAX_ATTEMPTS`: the demo must fail every attempt but the last, so a
// larger number here would exhaust the budget and the panel would never load.
/** How many of the retry anchor's loads reject before one resolves. @internal */
export const LAZY_RETRY_FAILURES = 2;

/** The retry anchor's status line before its first attempt. @internal */
export const LAZY_RETRY_PENDING = "Not loaded yet — this anchor's first two loads will reject on purpose.";

/** The line the `onError` handler writes after each rejected attempt. @internal */
export function lazyRetryAttempt(attempt: number): string {
  return `Attempt ${attempt} of ${LAZY_RETRY_FAILURES + 1} rejected — retrying.`;
}

/** The line the retry anchor shows once an attempt finally resolves. @internal */
export const LAZY_RETRY_LOADED = `Loaded on attempt ${LAZY_RETRY_FAILURES + 1}, after ${LAZY_RETRY_FAILURES} rejections.`;

/** The rows the deferred module builds — the payload that is absent until it arrives. @internal */
export const LAZY_PANEL_ROWS: readonly { readonly name: string; readonly cost: string }[] = [
  { name: "Rich text editor", cost: "182 kB" },
  { name: "Chart renderer", cost: "94 kB" },
  { name: "Date picker", cost: "41 kB" },
  { name: "Syntax highlighter", cost: "77 kB" },
  { name: "Diff viewer", cost: "36 kB" },
];

/** The heading the deferred module writes above its rows. @internal */
export const LAZY_PANEL_TITLE = "Everything below arrived with the module";
