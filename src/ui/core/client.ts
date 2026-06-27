/**
 * Core component client scopes — registers `toast` and `alert` resumable scopes.
 *
 * Import this module once in the app's client entry (side-effect import) BEFORE
 * calling `resume()`. Both scopes handle dismiss; the `toast` scope also handles
 * timed auto-close via the `duration` value serialised into `data-state`.
 */

import { registerScope } from "../client/resume";

registerScope<"dismiss">("toast", {
  eager: true,
  setup({ root, state }) {
    const ms = Number(state.duration?.value) || 0;
    if (ms > 0) setTimeout(() => root.remove(), ms);
  },
  on: { dismiss: ({ root }) => root.remove() },
});

registerScope<"dismiss">("alert", { on: { dismiss: ({ root }) => root.remove() } });
