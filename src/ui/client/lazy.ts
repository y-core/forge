import { ownerDocument, ownerWindow } from "./dom";

/** How many times {@link lazy} calls `load()` for one element before it gives up. */
const LAZY_MAX_ATTEMPTS = 3;

/** Wait between retries. `observe()` re-fires on the next frame for an element already on screen,
 *  so an immediate re-observe spends the whole attempt budget inside a few frames — three `load()`
 *  calls in ~32ms recover from a failure that is already over, never from one in progress. */
const LAZY_RETRY_DELAY_MS = 500;

export interface LazyImportOptions<T> {
  ref: string;
  load: () => Promise<T>;
  init: (mod: T, el: Element) => void;
  rootMargin?: string;
  threshold?: number | number[];
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
  /** Invoked when `load()` rejects — the element is re-observed after a short delay so a later
   *  intersection retries, up to a small attempt cap — and when `init` throws, which is reported
   *  without a retry. */
  onError?: (error: unknown) => void;
}

export interface LazyLoadOptions {
  triggerSelector: string;
  event: string;
  scriptSrc: string;
  /** SHA-256/384/512 SRI hash, e.g. `"sha384-abc..."`. Sets `crossOrigin="anonymous"` automatically. Pass `false` to explicitly opt out. */
  integrity: string | false;
  onLoad?: () => void;
  /** Any node in the document to search and inject into. Omit for the top-level page. */
  within?: Node;
}

/**
 * Defers loading a module until its anchor element enters the viewport via IntersectionObserver.
 *
 * A rejected `load()` is reported to `onError` and then retried: after `LAZY_RETRY_DELAY_MS` the
 * element is re-observed, so the next intersection tries again, up to `LAZY_MAX_ATTEMPTS` calls in
 * total. Both bounds carry weight. The cap keeps a retry from spinning — `observe()` invokes its
 * callback immediately for an element that is already intersecting, so an unbounded re-observe on a
 * visible element is a tight loop, not a retry. The delay is what makes the retry a retry: without
 * it the whole attempt budget is spent within a few frames of the first failure. Re-observing rather
 * than calling `load()` again preserves the lazy contract, since an element scrolled out of view in
 * the meantime waits for re-entry instead of loading off-screen.
 *
 * A throw from `init` is reported to `onError` and stops there — the load itself succeeded, so
 * re-running it would only re-run the same failing `init`.
 *
 * The disposer sets `disposed` and clears a pending retry timer, so a load still in flight when the
 * scope tears down never touches the element again: it neither re-observes nor runs `init`.
 * @public
 */
export function lazy<T>(options: LazyImportOptions<T>): () => void {
  const el = ownerDocument(options.within).querySelector(`[data-ref='${CSS.escape(options.ref)}']`);
  if (!el) return () => {};

  const init: IntersectionObserverInit = {};
  if (options.rootMargin !== undefined) init.rootMargin = options.rootMargin;
  if (options.threshold !== undefined) init.threshold = options.threshold;

  // The retry timer belongs to the element's own realm, not the top-level page.
  const win = ownerWindow(el);

  // The observer comes from that same realm, which is also what answers "does this browser have one
  // at all". Not for a geometric reason — intersection geometry is realm-insensitive, so a top-level
  // constructor handed a framed element fires just as one from the frame's own realm does. What the
  // resolved read buys is the realm that lacks the constructor: off the bare global that throws, and
  // here it degrades to a no-op disposer. See `UI_CLIENT_RUNTIME.md` §6a.
  const observerCtor = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof observerCtor !== "function") return () => {};

  let disposed = false;
  let attempts = 0;
  let retryId = 0;

  const observer = new observerCtor((entries) => {
    if (!entries[0]?.isIntersecting) return;
    observer.disconnect();
    attempts += 1;
    options.load().then(
      (mod) => {
        // A load that settles after the scope tore down must not mount onto an element the app has
        // already swapped out; whatever `init` sets up would hand its disposer to nobody and leak.
        if (disposed) return;
        try {
          options.init(mod, el);
        } catch (error) {
          // The load succeeded, so there is nothing to retry — re-running it would only re-run the
          // same failing `init`. Reported and stopped, which is the difference between this and the
          // rejection handler below. Catching it here also keeps the fulfilment path from rejecting
          // with no handler attached: `onRejected` below is a sibling of this callback, not
          // downstream of it, so a throw here would land nowhere.
          options.onError?.(error);
        }
      },
      (error) => {
        options.onError?.(error);
        if (disposed || attempts >= LAZY_MAX_ATTEMPTS) return;
        retryId = win.setTimeout(() => {
          retryId = 0;
          // Re-checked on fire: the scope may have torn down while the delay was elapsing.
          if (!disposed) observer.observe(el);
        }, LAZY_RETRY_DELAY_MS);
      },
    );
  }, init);
  observer.observe(el);

  return () => {
    disposed = true;
    win.clearTimeout(retryId);
    observer.disconnect();
  };
}

/** Injects a `<script>` tag on the first occurrence of an event, with optional SRI integrity. @public */
export function loadScriptOnEvent(options: LazyLoadOptions): void {
  const doc = ownerDocument(options.within);
  const element = doc.querySelector<HTMLElement>(options.triggerSelector);
  if (!element) return;

  element.addEventListener(
    options.event,
    () => {
      if (doc.querySelector(`script[src="${CSS.escape(options.scriptSrc)}"]`)) return;

      const script = doc.createElement("script") as HTMLScriptElement;
      script.src = options.scriptSrc;
      script.async = true;
      if (options.integrity !== false) {
        script.integrity = options.integrity;
        script.crossOrigin = "anonymous";
      }
      if (options.onLoad) {
        script.addEventListener("load", options.onLoad);
      }
      doc.head.appendChild(script);
    },
    { once: true },
  );
}

/**
 * The promise for every link {@link loadStylesheet} is still waiting on, per document. Without it a
 * second caller sees the first caller's `<link>` the instant it is appended — before its `load`
 * event — and the duplicate check would report it as already loaded. Keyed on `Document` so a widget
 * in an iframe caches against its own realm, and so a test with a fresh fake document starts empty.
 */
const inFlightStylesheets = new WeakMap<Document, Map<string, Promise<void>>>();

/**
 * Dynamically loads a stylesheet by appending a `<link rel="stylesheet">` to `document.head`.
 * Resolves once the stylesheet's `load` event fires; rejects with
 * `Error("Failed to load stylesheet: <href>")` on the `error` event (bad URL, network
 * failure, or integrity mismatch). Pass `integrity: false` to skip subresource-integrity
 * attributes (e.g. same-origin assets).
 *
 * Idempotent, and concurrency-safe with it. A caller that arrives while an earlier call is still
 * loading joins that call's promise, so it settles on the real `load`/`error` rather than
 * immediately; a caller that finds a `<link>` this function did not create (SSR markup, third-party
 * code) still resolves at once, since there is no event left to wait for. A failed load removes its
 * `<link>` as well as its cache entry, so a later call retries with a fresh `<link>` rather than
 * finding the dead one and resolving against a stylesheet that never loaded.
 */
export function loadStylesheet(href: string, integrity: string | false, within?: Node): Promise<void> {
  const doc = ownerDocument(within);
  const map = inFlightStylesheets.get(doc) ?? new Map<string, Promise<void>>();
  inFlightStylesheets.set(doc, map);

  const pending = map.get(href);
  if (pending) return pending;

  if (doc.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) {
    return Promise.resolve();
  }

  const promise = new Promise<void>((resolve, reject) => {
    const link = doc.createElement("link") as HTMLLinkElement;
    link.rel = "stylesheet";
    link.href = href;
    if (integrity !== false) {
      link.integrity = integrity;
      link.crossOrigin = "anonymous";
    }
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", () => {
      // Evicting the cache entry is not enough on its own: the next call misses the map and falls
      // through to the duplicate check above, which would find this dead `<link>` and resolve for a
      // stylesheet that never loaded. Removal is synchronous, so by the time any later call runs
      // that check there is nothing stale left to find — and per-link, so it needs none of the
      // identity guarding the cache eviction below does. Only the failed link goes; a loaded one
      // must stay.
      link.remove();
      reject(new Error(`Failed to load stylesheet: ${href}`));
    });
    doc.head.appendChild(link);
  });

  map.set(href, promise);
  // The identity check keeps a slow failure from evicting a newer entry for the same href. The
  // derived promise is handled by this very `catch`, so eviction adds no unhandled rejection — and
  // the caller still receives `promise` itself.
  promise.catch(() => {
    if (map.get(href) === promise) map.delete(href);
  });

  return promise;
}
