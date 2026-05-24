import { createSignal, effect } from "./signal";

/** Wires accessible open/close behaviour to `[data-ref="nav-toggle"]` and `[data-ref="nav-menu"]` elements. @public */
export function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-ref='nav-toggle']");
  const menu = document.querySelector<HTMLElement>("[data-ref='nav-menu']");
  if (!toggle || !menu) return;

  const isOpen = createSignal(false);

  effect(() => {
    menu.classList.toggle("hidden", !isOpen.value);
    toggle.setAttribute("aria-expanded", String(isOpen.value));
  });

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen.value = !isOpen.value;
  });

  menu.querySelectorAll<HTMLAnchorElement>("[data-ref='nav-link']").forEach((link) => {
    link.addEventListener("click", () => { isOpen.value = false; });
  });

  document.addEventListener("click", (e) => {
    if (isOpen.value && !menu.contains(e.target as Node) && e.target !== toggle) {
      isOpen.value = false;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen.value) {
      isOpen.value = false;
    }
  });
}
