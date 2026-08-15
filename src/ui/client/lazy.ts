import { ownerDocument, ownerWindow } from "./dom";

/** How many times {@link lazy} calls `load()` for one element before it gives up. */
const LAZY_MAX_ATTEMPTS = 3;

/** Wait between retries. `observe()` re-fires on the next frame for an element already on screen,
 *  so an immediate re-observe spends the whole attempt budget inside a few frames. */
const LAZY_RETRY_DELAY_MS = 500;

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

/** Defers loading a module until its anchor element enters the viewport, retrying a rejected load up to `LAZY_MAX_ATTEMPTS` times. @public */
export function lazy<T>(options: LazyImportOptions<T>): () => void {
  const el = ownerDocument(options.within).querySelector(`[data-ref='${CSS.escape(options.ref)}']`);
  // A property of the rendered page — the anchor is free not to be on this route — so it reports.
  if (!el) {
    console.warn(`[lazy] no [data-ref="${options.ref}"] in this document; "${options.ref}" will never load`);
    return () => {};
  }

  const init: IntersectionObserverInit = {};
  if (options.rootMargin !== undefined) init.rootMargin = options.rootMargin;
  if (options.threshold !== undefined) init.threshold = options.threshold;

  const win = ownerWindow(el);

  // Resolved off the element's realm so a realm lacking the constructor degrades to a no-op disposer
  // rather than throwing off the bare global. See `UI_CLIENT_RUNTIME.md` §6a.
  const observerCtor = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof observerCtor !== "function") {
    console.warn(`[lazy] IntersectionObserver is unavailable in this realm; "${options.ref}" will never load`);
    return () => {};
  }

  /** Every failure reaches somewhere: without a handler the error was dropped outright, so a load
   * that never arrived looked identical to one that was never scheduled. */
  const report = (error: unknown) => {
    if (options.onError) options.onError(error);
    else console.error(`[lazy] "${options.ref}" failed to load`, error);
  };

  let disposed = false;
  let attempts = 0;
  let retryId = 0;

  const observer = new observerCtor((entries) => {
    if (!entries[0]?.isIntersecting) return;
    observer.disconnect();
    attempts += 1;
    options.load().then(
      (mod) => {
        if (disposed) return;
        try {
          options.init(mod, el);
        } catch (error) {
          // Caught here rather than left to the rejection handler below, which is a sibling of this
          // callback and not downstream of it — a throw here would land nowhere.
          report(error);
        }
      },
      (error) => {
        report(error);
        if (disposed || attempts >= LAZY_MAX_ATTEMPTS) return;
        retryId = win.setTimeout(() => {
          retryId = 0;
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
