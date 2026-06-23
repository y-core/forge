/**
 * Single source of truth for the delegated-event vocabulary shared by the client resume
 * runtime (`ui/client/resume.ts` installs one listener per entry) and the server attribute
 * helper (`ui/server/scope-attrs.ts` emits one `data-on-<event>` per entry). Keeping both in
 * lockstep prevents the listener set and the emitted attributes from drifting apart.
 *
 * Pure data, side-effect-free — safe to import into either bundle. Internal: not part of the
 * package's public export surface.
 */

/** The DOM events a resumable scope delegates on. */
export const SCOPE_EVENTS = ["click", "input", "change", "submit"] as const;

/** One of the delegated scope events. */
export type ScopeEvent = (typeof SCOPE_EVENTS)[number];
