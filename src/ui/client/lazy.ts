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

/** Defers loading a module until its anchor element enters the viewport, retrying a rejected load up to `LAZY_MAX_ATTEMPTS` times. @public */
export function lazy<T>(options: LazyImportOptions<T>): () => void {
  const el = ownerDocument(options.within).querySelector(`[data-ref='${CSS.escape(options.ref)}']`);
  if (!el) return () => {};

  const init: IntersectionObserverInit = {};
  if (options.rootMargin !== undefined) init.rootMargin = options.rootMargin;
  if (options.threshold !== undefined) init.threshold = options.threshold;

  const win = ownerWindow(el);

  // Resolved off the element's realm so a realm lacking the constructor degrades to a no-op disposer
  // rather than throwing off the bare global. See `UI_CLIENT_RUNTIME.md` §6a.
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
        if (disposed) return;
        try {
          options.init(mod, el);
        } catch (error) {
          // Caught here rather than left to the rejection handler below, which is a sibling of this
          // callback and not downstream of it — a throw here would land nowhere.
          options.onError?.(error);
        }
      },
      (error) => {
        options.onError?.(error);
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

/** The promise for every link {@link loadStylesheet} is still waiting on, per document. A second
 * caller sees the first caller's `<link>` the instant it is appended — before its `load` event — so
 * the duplicate check alone would report it as already loaded. */
const inFlightStylesheets = new WeakMap<Document, Map<string, Promise<void>>>();

/** Loads a stylesheet by appending a `<link rel="stylesheet">`, resolving on its `load` event and rejecting on `error`. */
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
      // Removed as well as evicted: the next call would otherwise miss the map, find this dead
      // `<link>` in the duplicate check above, and resolve for a stylesheet that never loaded.
      link.remove();
      reject(new Error(`Failed to load stylesheet: ${href}`));
    });
    doc.head.appendChild(link);
  });

  map.set(href, promise);
  // The identity check keeps a slow failure from evicting a newer entry for the same href.
  promise.catch(() => {
    if (map.get(href) === promise) map.delete(href);
  });

  return promise;
}
