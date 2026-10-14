import { ownerDocument, ownerWindow } from "./dom";
import type { LazyImportOptions } from "./types";

const LAZY_MAX_ATTEMPTS = 3;

// `observe()` re-fires on the next frame, so an immediate retry burns the attempt budget.
const LAZY_RETRY_DELAY_MS = 500;

/** Defers loading a module until its anchor element enters the viewport, retrying a rejected load up to `LAZY_MAX_ATTEMPTS` times. @public */
export function lazy<T>(options: LazyImportOptions<T>): () => void {
  const el = ownerDocument(options.within).querySelector(`[data-ref='${CSS.escape(options.ref)}']`);
  if (!el) {
    console.warn(`[lazy] no [data-ref="${options.ref}"] in this document; "${options.ref}" will never load`);
    return () => {};
  }

  const init: IntersectionObserverInit = {};
  if (options.rootMargin !== undefined) init.rootMargin = options.rootMargin;
  if (options.threshold !== undefined) init.threshold = options.threshold;

  const win = ownerWindow(el);

  const observerCtor = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof observerCtor !== "function") {
    console.warn(`[lazy] IntersectionObserver is unavailable in this realm; "${options.ref}" will never load`);
    return () => {};
  }

  const report = (error: unknown) => {
    if (options.onError) options.onError(error);
    else console.error(`[lazy] "${options.ref}" failed to load`, error);
  };

  const lifetime = new AbortController();
  let attempts = 0;
  let retryId = 0;

  const observer = new observerCtor((entries) => {
    if (!entries[0]?.isIntersecting) return;
    observer.disconnect();
    attempts += 1;
    options.load().then(
      (mod) => {
        if (lifetime.signal.aborted) return;
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
        if (lifetime.signal.aborted || attempts >= LAZY_MAX_ATTEMPTS) return;
        retryId = win.setTimeout(() => {
          retryId = 0;
          if (!lifetime.signal.aborted) observer.observe(el);
        }, LAZY_RETRY_DELAY_MS);
      },
    );
  }, init);
  observer.observe(el);

  return () => {
    lifetime.abort();
    win.clearTimeout(retryId);
    observer.disconnect();
  };
}
