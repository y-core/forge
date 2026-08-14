/** The DOM events a resumable scope delegates on. @public */
export const SCOPE_EVENTS = ["click", "input", "change", "submit"] as const;

/** One of the delegated scope events. @public */
export type ScopeEvent = (typeof SCOPE_EVENTS)[number];
