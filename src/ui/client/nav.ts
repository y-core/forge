import { contains, eventTarget, ownerDocument } from "./dom";
import { createSignal, effect } from "./signal";

export interface NavControllerOptions {
  menuSelector?: string;
  toggleSelector?: string;
  linkSelector?: string;
  /** Any node in the document to mount within. Omit for the top-level page; pass one when the
   * navbar lives in an iframe, so the outside-click and Escape listeners land on its own document. */
  within?: Node;
}

const mountedNavs = new WeakMap<HTMLButtonElement, () => void>();

/** Mounts accessible open/close behaviour for the navigation toggle and returns a cleanup function. @public */
export function mountNav(options?: NavControllerOptions): () => void {
  const {
    linkSelector = "[data-ref='nav-link']",
    menuSelector = "[data-ref='nav-menu']",
    toggleSelector = "[data-ref='nav-toggle']",
  } = options ?? {};

  const doc = ownerDocument(options?.within);
  const toggle = doc.querySelector<HTMLButtonElement>(toggleSelector);
  const menu = doc.querySelector<HTMLElement>(menuSelector);
  if (!toggle || !menu) {
    return () => {};
  }

  const existing = mountedNavs.get(toggle);
  if (existing) {
    return existing;
  }

  const isOpen = createSignal(false);
  const disposeEffect = effect(() => {
    menu.classList.toggle("hidden", !isOpen.value);
    toggle.setAttribute("aria-expanded", String(isOpen.value));
  });

  const onToggle = (event: Event) => {
    event.stopPropagation();
    isOpen.value = !isOpen.value;
  };

  const onDocumentClick = (event: Event) => {
    if (!isOpen.value) {
      return;
    }

    // Shadow-safe on both counts: `eventTarget` sees past retargeting to the element actually hit,
    // and `contains` climbs shadow hosts, so a click on a menu item inside a web component is not
    // mistaken for an outside click that closes the menu.
    const target = eventTarget(event) as Node | null;
    if (!target || (!contains(menu, target) && target !== toggle)) {
      isOpen.value = false;
    }
  };

  const onDocumentKeydown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === "Escape" && isOpen.value) {
      isOpen.value = false;
    }
  };

  const linkEntries = menu.querySelectorAll<HTMLAnchorElement>(linkSelector);
  const onLinkClick = () => {
    isOpen.value = false;
  };

  toggle.addEventListener("click", onToggle);
  doc.addEventListener("click", onDocumentClick);
  doc.addEventListener("keydown", onDocumentKeydown);
  linkEntries.forEach((link) => {
    link.addEventListener("click", onLinkClick);
  });

  const cleanup = () => {
    disposeEffect();
    toggle.removeEventListener("click", onToggle);
    doc.removeEventListener("click", onDocumentClick);
    doc.removeEventListener("keydown", onDocumentKeydown);
    linkEntries.forEach((link) => {
      link.removeEventListener("click", onLinkClick);
    });
    mountedNavs.delete(toggle);
  };

  mountedNavs.set(toggle, cleanup);
  return cleanup;
}
