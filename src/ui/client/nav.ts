export function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-ref='nav-toggle']");
  const menu = document.querySelector<HTMLElement>("[data-ref='nav-menu']");
  if (!toggle || !menu) return;

  const menuEl = menu;
  const toggleEl = toggle;

  function closeMenu(): void {
    menuEl.classList.add("hidden");
    toggleEl.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains("hidden");
    menu.classList.toggle("hidden", open);
    toggle.setAttribute("aria-expanded", String(!open));
  });

  menu.querySelectorAll<HTMLAnchorElement>("[data-ref='nav-link']").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (e) => {
    if (
      !menu.classList.contains("hidden") &&
      !menu.contains(e.target as Node) &&
      e.target !== toggle
    ) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.classList.contains("hidden")) {
      closeMenu();
    }
  });
}
