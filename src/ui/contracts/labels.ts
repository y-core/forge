/** Every English accessible name forge falls back to where the caller named nothing; each is overridable by the prop beside it. @public */
export const LABEL_DEFAULTS = {
  alertDismiss: "Dismiss",
  breadcrumbs: "Breadcrumb",
  carouselDots: "Slides",
  carouselSlide: "Slide",
  carouselStrip: "Slides",
  dock: "Primary",
  filterReset: "Clear",
  navbarToggle: "Menu",
  numberFieldDecrement: "Decrement",
  numberFieldIncrement: "Increment",
  pagination: "Pagination",
  paginationEllipsis: "More pages",
  spinner: "Loading…",
  themeDark: "Switch theme — currently dark",
  themeLight: "Switch theme — currently light",
  themeSystem: "Switch theme — currently system",
  toast: "Notifications",
  toastDismiss: "Dismiss notification",
  turnstileFallback: "The security challenge couldn't load. Please disable any ad or script blockers for this site and reload the page.",
  turnstileUnsupported: "This browser cannot run the security challenge. Please try again in a current version of Chrome, Edge, Firefox or Safari.",
} as const;

/** The word a screen reader gets for each step or timeline state, since the marker differs only in colour. @public */
export const STEP_STATE_LABELS = { complete: "Completed", current: "Current", upcoming: "Not started" } as const;
