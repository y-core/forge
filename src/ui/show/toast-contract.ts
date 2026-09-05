/** The resumable scope that owns the showcase's one live toast box. @internal */
export const TOAST_CYCLE_SCOPE = "show-toast-cycle";

/** The toast's own `duration` — what `Flash` ships, so the box shows the real dismissal. @internal */
export const TOAST_CYCLE_DURATION = 5000;

// Showcase-only. A shipped toast is gone once its duration elapses; putting one back on a timer is a
// demo device, not a `Toast` behaviour, and it lives here rather than in `ui/core` for that reason.
/** How long the box stays empty before the scope re-inserts the toast. @internal */
export const TOAST_CYCLE_GAP = 2000;
