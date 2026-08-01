/**
 * Core component client scopes — every resumable scope the `ui/core` components stamp.
 *
 * Import this module once in the app's client entry (side-effect import) BEFORE
 * calling `resume()`. `toast` and `alert` handle dismiss; the `toast` scope also handles
 * timed auto-close via the `duration` value serialised into `data-state`. `toolbar` mounts roving
 * focus, which is why it is eager: a single tab stop has to exist before the first interaction,
 * or every item stays individually tabbable until the user happens to click one.
 *
 * **Eager is the default here, and `toggle` is the exception.** A scope resumes lazily only if its
 * markup carries a `data-on-*` action to resume it on; every scope below whose behaviour is
 * `setup`-only has no such action and must therefore be eager, or it never runs at all.
 */

import { mountRovingFocus } from "../client/composite";
import { ownerWindow } from "../client/dom";
import { mountMenu } from "../client/menu";
import { mountNumberField } from "../client/number-field";
import { registerScope } from "../client/resume";
import { mountTabs } from "../client/tabs";
import { mountTooltip } from "../client/tooltip";
import { mountPopupTriggerState, mountTransitionState } from "../client/transition";
import { MENU_SCOPE } from "../contracts/menu-contract";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { DIALOG_SCOPE, POPOVER_SCOPE } from "../contracts/overlay-contract";
import { applyStateAttrs } from "../contracts/state-attrs";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import { ACCORDION_SCOPE, COLLAPSIBLE_SCOPE, TOGGLE_SCOPE, TOOLTIP_SCOPE, type ToggleAction } from "../contracts/toggle-contract";
import { TOOLBAR_ITEM_SELECTOR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";

registerScope<"dismiss">("toast", {
  eager: true,
  setup({ root, state }) {
    const ms = Number(state.duration?.value) || 0;
    // The toast's own realm schedules its own dismissal — a bare `setTimeout` would fire on the
    // top-level window's clock, which an iframe can have torn down underneath it.
    if (ms > 0) {
      const win = ownerWindow(root);
      win.setTimeout(() => root.remove(), ms);
    }
  },
  on: { dismiss: ({ root }) => root.remove() },
});

registerScope<"dismiss">("alert", { on: { dismiss: ({ root }) => root.remove() } });

registerScope(TOOLBAR_SCOPE, {
  eager: true,
  setup: ({ root }) =>
    mountRovingFocus(root, {
      items: TOOLBAR_ITEM_SELECTOR,
      // The root's own `data-orientation` decides which arrows navigate, so a vertical toolbar needs
      // no second declaration on the client.
      orientation: root.getAttribute("data-orientation") === "vertical" ? "vertical" : "horizontal",
    }),
});

registerScope(MENU_SCOPE, { eager: true, setup: ({ root }) => mountMenu(root) });

registerScope(TABS_SCOPE, { eager: true, setup: ({ root }) => mountTabs(root) });

registerScope(TOOLTIP_SCOPE, { eager: true, setup: ({ root }) => mountTooltip(root) });

// `<details>` owns open and closed; the controller only publishes them for CSS to react to. Same for
// an Accordion item, which is the same element playing the same part.
registerScope(COLLAPSIBLE_SCOPE, { eager: true, setup: ({ root }) => mountTransitionState(root) });

registerScope(ACCORDION_SCOPE, { eager: true, setup: ({ root }) => mountTransitionState(root) });

/**
 * A native overlay publishes two things: its own open state, and its triggers'. Both are eager out
 * of necessity rather than taste — the markup carries no `data-on-*` action, because opening,
 * closing, Escape and light-dismiss are all the platform's, so a lazy scope would have nothing to
 * resume it and every state attribute would stay frozen at its server-rendered value.
 */
const mountOverlay = ({ root }: { root: HTMLElement }): (() => void) => {
  const disposeTransition = mountTransitionState(root);
  const disposeTriggers = mountPopupTriggerState(root);
  return () => {
    disposeTriggers();
    disposeTransition();
  };
};

registerScope(DIALOG_SCOPE, { eager: true, setup: mountOverlay });

registerScope(POPOVER_SCOPE, { eager: true, setup: mountOverlay });

registerScope<ToggleAction>(TOGGLE_SCOPE, {
  on: {
    toggle: ({ root }) => {
      const pressed = root.getAttribute("aria-pressed") !== "true";
      root.setAttribute("aria-pressed", String(pressed));
      applyStateAttrs(root, { pressed });
    },
  },
});

// Eager like the other setup-only scopes: the stepper buttons carry no `data-on-*` action, so a
// lazy scope would have nothing to resume it and the buttons would stay inert.
registerScope(NUMBER_FIELD_SCOPE, { eager: true, setup: ({ root }) => mountNumberField(root) });
