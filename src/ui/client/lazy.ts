import { ownerDocument } from "./dom";

export interface LazyImportOptions<T> {
  ref: string;
  load: () => Promise<T>;
  init: (mod: T, el: Element) => void;
  rootMargin?: string;
  threshold?: number | number[];
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
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

/** Defers loading a module until its anchor element enters the viewport via IntersectionObserver. @public */
export function lazy<T>(options: LazyImportOptions<T>): () => void {
  const el = ownerDocument(options.within).querySelector(`[data-ref='${CSS.escape(options.ref)}']`);
  if (!el) return () => {};

  const init: IntersectionObserverInit = {};
  if (options.rootMargin !== undefined) init.rootMargin = options.rootMargin;
  if (options.threshold !== undefined) init.threshold = options.threshold;

  const observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      observer.disconnect();
      options.load().then((mod) => options.init(mod, el));
    }
  }, init);
  observer.observe(el);

  return () => observer.disconnect();
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
 * Dynamically loads a stylesheet by appending a `<link rel="stylesheet">` to `document.head`.
 * Resolves once the stylesheet's `load` event fires; rejects with
 * `Error("Failed to load stylesheet: <href>")` on the `error` event (bad URL, network
 * failure, or integrity mismatch). Idempotent: if a link with the same `href` already
 * exists, resolves immediately without appending a duplicate. Pass `integrity: false`
 * to skip subresource-integrity attributes (e.g. same-origin assets).
 */
export function loadStylesheet(href: string, integrity: string | false, within?: Node): Promise<void> {
  const doc = ownerDocument(within);
  if (doc.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const link = doc.createElement("link") as HTMLLinkElement;
    link.rel = "stylesheet";
    link.href = href;
    if (integrity !== false) {
      link.integrity = integrity;
      link.crossOrigin = "anonymous";
    }
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", () => reject(new Error(`Failed to load stylesheet: ${href}`)));
    doc.head.appendChild(link);
  });
}
