/** Registers every resumable client scope the `ui/core` components stamp; side-effect import before `resume()`. */

import { mountRovingFocus } from "../client/composite";
import { ownerWindow } from "../client/dom";
import { checkMenuItem, mountMenu } from "../client/menu";
import { mountNumberField } from "../client/number-field";
import { mountExpandedState, mountExpandedStates } from "../client/popover-expanded";
import { registerScope } from "../client/resume";
import { mountTabs } from "../client/tabs";
import { dismissToast } from "../client/toast";
import { mountTooltip } from "../client/tooltip";
import { mountTurnstile } from "../client/turnstile";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE } from "../contracts/dialog-contract";
import { MENU_SCOPE, type MenuAction } from "../contracts/menu-contract";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { POPOVER_SCOPE } from "../contracts/overlay-contract";
import { SLIDER_SCOPE, type SliderAction } from "../contracts/slider-contract";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import { TOGGLE_GROUP_ITEM_SELECTOR, TOGGLE_GROUP_SCOPE, TOOLTIP_SCOPE } from "../contracts/toggle-contract";
import { TOOLBAR_ITEM_SELECTOR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { TURNSTILE_SCOPE } from "../contracts/turnstile-contract";

registerScope<"dismiss">("toast", {
  eager: true,
  setup({ root, state }) {
    const ms = Number(state.duration?.value) || 0;
    if (ms <= 0) return;
    // The toast's own realm schedules its own dismissal — a bare `setTimeout` would fire on the
    // top-level window's clock, which an iframe can have torn down underneath it.
    const win = ownerWindow(root);
    const id = win.setTimeout(() => dismissToast(root), ms);
    return () => win.clearTimeout(id);
  },
  on: { dismiss: ({ root }) => dismissToast(root) },
});

registerScope<"dismiss">("alert", { on: { dismiss: ({ root }) => root.remove() } });

registerScope(TOOLBAR_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    const disposeFocus = mountRovingFocus(root, {
      items: TOOLBAR_ITEM_SELECTOR,
      orientation: root.getAttribute("data-orientation") === "vertical" ? "vertical" : "horizontal",
    });
    const disposeExpanded = mountExpandedStates(root);
    return () => {
      disposeExpanded();
      disposeFocus();
    };
  },
});

registerScope<MenuAction>(MENU_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    const disposeMenu = mountMenu(root);
    const disposeExpanded = mountExpandedState(root);
    return () => {
      disposeExpanded();
      disposeMenu();
    };
  },
  on: { check: ({ root, el }) => checkMenuItem(el, root), select: ({ root, el }) => checkMenuItem(el, root) },
});

registerScope(POPOVER_SCOPE, { eager: true, setup: ({ root }) => mountExpandedState(root) });

registerScope(TABS_SCOPE, { eager: true, setup: ({ root }) => mountTabs(root) });

registerScope(TOOLTIP_SCOPE, { eager: true, setup: ({ root }) => mountTooltip(root) });

// Only the `multiple` shape needs this: a radio group is already one tab stop with native arrow-key
// navigation, and mounting roving focus over it would replace the platform's behaviour with a copy.
registerScope(TOGGLE_GROUP_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    if (!root.hasAttribute("data-multiple")) return;
    return mountRovingFocus(root, {
      items: TOGGLE_GROUP_ITEM_SELECTOR,
      orientation: root.getAttribute("data-orientation") === "vertical" ? "vertical" : "horizontal",
    });
  },
});

registerScope(NUMBER_FIELD_SCOPE, { eager: true, setup: ({ root }) => mountNumberField(root) });

registerScope<SliderAction>(SLIDER_SCOPE, {
  on: {
    sync: ({ root, el }) => {
      const readout = root.querySelector("[data-slot~='slider-output']");
      if (readout) readout.textContent = (el as HTMLInputElement).value;
    },
  },
});

registerScope(DIALOG_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    // `showModal()` is the only spelling of a modal dialog: the `open` attribute always yields a
    // non-modal one, so an SSR-open modal has to be opened here or not at all.
    if (root.hasAttribute(DIALOG_OPEN_MODAL_ATTR)) (root as HTMLDialogElement).showModal?.();
  },
});

// Eager, but nothing is fetched here: `setup` only installs the `focusin` listener that gates
// Cloudflare's script, so a page whose markup renders no widget never resumes this scope at all.
registerScope(TURNSTILE_SCOPE, { eager: true, setup: ({ root }) => mountTurnstile(root) });
