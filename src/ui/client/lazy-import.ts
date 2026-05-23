export interface LazyImportOptions<T> {
  ref: string;
  load: () => Promise<T>;
  init: (mod: T, el: Element) => void;
  rootMargin?: string;
  threshold?: number | number[];
}

export function lazy<T>(options: LazyImportOptions<T>): () => void {
  const el = document.querySelector(`[data-ref='${options.ref}']`);
  if (!el) return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        options.load().then((mod) => options.init(mod, el));
      }
    },
    { rootMargin: options.rootMargin, threshold: options.threshold },
  );
  observer.observe(el);

  return () => observer.disconnect();
}
