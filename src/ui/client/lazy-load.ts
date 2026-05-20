export interface LazyLoadOptions {
  triggerSelector: string;
  event: string;
  scriptSrc: string;
  onLoad?: () => void;
}

export function loadScriptOnEvent(options: LazyLoadOptions): void {
  const element = document.querySelector<HTMLElement>(options.triggerSelector);
  if (!element) return;

  element.addEventListener(
    options.event,
    () => {
      if (document.querySelector(`script[src="${options.scriptSrc}"]`)) return;

      const script = document.createElement("script");
      script.src = options.scriptSrc;
      script.async = true;
      if (options.onLoad) {
        script.addEventListener("load", options.onLoad);
      }
      document.head.appendChild(script);
    },
    { once: true },
  );
}
