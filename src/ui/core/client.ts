/** Registers every resumable client scope the `ui/core` components stamp; side-effect import before `resume()`. */

import { dismissAlert } from "../client/alert";
import { announceFailure, announceFieldError } from "../client/announce";
import { mountRovingFocus } from "../client/composite";
import { ownerDocument } from "../client/dom";
import { mountFilter } from "../client/filter";
import { mountInputFormat } from "../client/input-format";
import { checkMenuItem, mountMenu } from "../client/menu";
import { mountNumberField } from "../client/number-field";
import { mountOtpInput } from "../client/otp-input";
import { mountExpandedState, mountExpandedStates } from "../client/popover-expanded";
import { registerScope } from "../client/resume";
import { mountTabs } from "../client/tabs";
import { dismissToast, mountToastAnnouncements, scheduleToastDismissal } from "../client/toast";
import { mountTooltip } from "../client/tooltip";
import { mountTurnstile } from "../client/turnstile";
import { ALERT_SCOPE } from "../contracts/alert-contract";
import { ANNOUNCER_SCOPE } from "../contracts/announcer-contract";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE } from "../contracts/dialog-contract";
import { INPUT_FORMAT_SCOPE } from "../contracts/input-format-contract";
import { MENU_SCOPE } from "../contracts/menu-contract";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { OTP_INPUT_SCOPE } from "../contracts/otp-input-contract";
import { POPOVER_SCOPE } from "../contracts/overlay-contract";
import { SLIDER_SCOPE } from "../contracts/slider-contract";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import { TOAST_CONTAINER_SCOPE, TOAST_DURATION_KEY, TOAST_SCOPE } from "../contracts/toast-contract";
import { FILTER_SCOPE, TOGGLE_GROUP_ITEM_SELECTOR, TOGGLE_GROUP_SCOPE, TOOLTIP_SCOPE } from "../contracts/toggle-contract";
import { TOOLBAR_ITEM_SELECTOR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { TURNSTILE_SCOPE } from "../contracts/turnstile-contract";
import type { MenuAction } from "../contracts/types";
import type { SliderAction } from "../contracts/types";

registerScope<"dismiss">(TOAST_SCOPE, {
  eager: true,
  setup({ root, state }) {
    const ms = Number(state[TOAST_DURATION_KEY]?.value) || 0;
    if (ms <= 0) return;
    return scheduleToastDismissal(root, ms);
  },
  on: { dismiss: ({ root }) => dismissToast(root) },
});

registerScope(TOAST_CONTAINER_SCOPE, { eager: true, setup: ({ root }) => mountToastAnnouncements(root) });

registerScope(ANNOUNCER_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    announceFieldError(ownerDocument(root));
    announceFailure(ownerDocument(root));
  },
});

registerScope<"dismiss">(ALERT_SCOPE, { on: { dismiss: ({ root }) => dismissAlert(root) } });

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

registerScope(FILTER_SCOPE, { eager: true, setup: ({ root }) => mountFilter(root) });

registerScope(NUMBER_FIELD_SCOPE, { eager: true, setup: ({ root }) => mountNumberField(root) });

registerScope(INPUT_FORMAT_SCOPE, { eager: true, setup: ({ root }) => mountInputFormat(root) });

registerScope(OTP_INPUT_SCOPE, { eager: true, setup: ({ root }) => mountOtpInput(root) });

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
    // The `open` attribute always yields a non-modal dialog, so an SSR-open modal has to be opened
    // here — and `showModal()` throws `InvalidStateError` on one already open.
    const dialog = root as HTMLDialogElement;
    if (root.hasAttribute(DIALOG_OPEN_MODAL_ATTR) && !dialog.open) {
      dialog.showModal?.();
      dialog.addEventListener("close", () => root.removeAttribute(DIALOG_OPEN_MODAL_ATTR), { once: true });
    }
  },
});

// Eager, but nothing is fetched here: `setup` only installs the `focusin` listener that gates
// Cloudflare's script, so a page whose markup renders no widget never resumes this scope at all.
registerScope(TURNSTILE_SCOPE, { eager: true, setup: ({ root }) => mountTurnstile(root) });
