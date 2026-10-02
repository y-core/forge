import type { Autosave, AutosaveOptions } from "./types";

/** How long autosave waits after the last touch before saving, in milliseconds. */
export const AUTOSAVE_DEBOUNCE_MS = 2_000;

/** The longest autosave lets a touch go unsaved while touches keep arriving, in milliseconds. */
export const AUTOSAVE_MAX_WAIT_MS = 20_000;

/** Creates the save loop that saves after a quiet period, or at the latest after the max wait. */
export function createAutosave(options: AutosaveOptions): Autosave {
  const { save, timers } = options;
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
  let pending = false;
  let debounceTimer: number | null = null;
  let maxWaitTimer: number | null = null;
  let disposed = false;

  const clearTimers = (): void => {
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    if (maxWaitTimer !== null) timers.clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
  };

  const reset = (): void => {
    clearTimers();
    pending = false;
  };

  const flush = (): void => {
    if (disposed || !pending) return;
    reset();
    save();
  };

  const touch = (): void => {
    if (disposed) return;
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(flush, debounceMs);
    if (pending) return;
    pending = true;
    maxWaitTimer = timers.setTimeout(flush, maxWaitMs);
  };

  return {
    touch,
    flush,
    cancel: reset,
    dispose: () => {
      reset();
      disposed = true;
    },
    dirty: () => pending,
  };
}
