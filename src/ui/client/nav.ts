import { createSignal, effect } from "./signal";

export interface NavControllerOptions {
  menuSelector?: string;
  toggleSelector?: string;
  linkSelector?: string;
}

const mountedNavs = new WeakMap<HTMLButtonElement, () => void>();

/** Mounts accessible open/close behaviour for the navigation toggle and returns a cleanup function. @public */
export function mountNav(options?: NavControllerOptions): () => void {
  const {
    linkSelector = "[data-ref='nav-link']",
    menuSelector = "[data-ref='nav-menu']",
    toggleSelector = "[data-ref='nav-toggle']",
  } = options ?? {};

  const toggle = document.querySelector<HTMLButtonElement>(toggleSelector);
  const menu = document.querySelector<HTMLElement>(menuSelector);
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

    const target = event.target as Node | null;
    if (!target || (!menu.contains(target) && target !== toggle)) {
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
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
  linkEntries.forEach((link) => {
    link.addEventListener("click", onLinkClick);
  });

  const cleanup = () => {
    disposeEffect();
    toggle.removeEventListener("click", onToggle);
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onDocumentKeydown);
    linkEntries.forEach((link) => {
      link.removeEventListener("click", onLinkClick);
    });
    mountedNavs.delete(toggle);
  };

  mountedNavs.set(toggle, cleanup);
  return cleanup;
}
