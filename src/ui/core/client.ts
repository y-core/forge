/** Registers every resumable client scope the `ui/core` components stamp; side-effect import before `resume()`. */

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
      orientation: root.getAttribute("data-orientation") === "vertical" ? "vertical" : "horizontal",
    }),
});

registerScope(MENU_SCOPE, { eager: true, setup: ({ root }) => mountMenu(root) });

registerScope(TABS_SCOPE, { eager: true, setup: ({ root }) => mountTabs(root) });

registerScope(TOOLTIP_SCOPE, { eager: true, setup: ({ root }) => mountTooltip(root) });

registerScope(COLLAPSIBLE_SCOPE, { eager: true, setup: ({ root }) => mountTransitionState(root) });

registerScope(ACCORDION_SCOPE, { eager: true, setup: ({ root }) => mountTransitionState(root) });

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

registerScope(NUMBER_FIELD_SCOPE, { eager: true, setup: ({ root }) => mountNumberField(root) });
