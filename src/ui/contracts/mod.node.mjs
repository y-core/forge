// Generated from src/ui/contracts/mod.ts by `bun run gen:bundles` — do not edit.

// src/ui/contracts/alert-contract.ts
var ALERT_SCOPE = "alert";

// src/ui/contracts/announcer-contract.ts
var ANNOUNCER_SCOPE = "announcer";
var ANNOUNCER_REGION_SLOTS = {
  polite: "announcer-polite",
  assertive: "announcer-assertive"
};
var ANNOUNCE_SETTLE_MS = 200;
var ANNOUNCE_LINGER_MS = 7e3;
var ANNOUNCE_BUSY_CHANNEL = "busy";
var ANNOUNCE_FORM_ERROR_CHANNEL = "form-error";
var ANNOUNCE_FAILURE_CHANNEL = "failure";
var ANNOUNCE_FAILURE_ATTR = "data-announce-failure";
var ANNOUNCE_TOAST_CHANNEL = "toast";
var ANNOUNCE_TURNSTILE_CHANNEL = "turnstile";

// src/ui/contracts/bind-contract.ts
var BIND_TEXT_ATTR = "data-bind-text";
var BIND_ATTR_ATTR = "data-bind-attr";
var URL_BOUND_ATTRS = /* @__PURE__ */ new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "cite",
  "background",
  "data",
  "xlink:href",
  "xml:base"
]);
var SAFE_BOUND_SCHEMES = /* @__PURE__ */ new Set(["http:", "https:", "mailto:", "tel:"]);
var BOUND_URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;
var HX_SCRIPT_ATTRS = /* @__PURE__ */ new Set(["hx-vals", "hx-headers", "hx-confirm", "hx-trigger", "hx-status", "hx-config"]);
function hxBaseName(attribute) {
  const lower = attribute.toLowerCase();
  const unprefixed = lower.startsWith("data-") ? lower.slice("data-".length) : lower;
  return unprefixed.split(":")[0] ?? unprefixed;
}
function isBindAttrRefused(attribute) {
  const lower = attribute.toLowerCase();
  const base = hxBaseName(attribute);
  const isHxOn = base.startsWith("hx-on");
  const isHxScript = HX_SCRIPT_ATTRS.has(base);
  return lower.startsWith("on") || isHxOn || isHxScript || lower === "srcdoc" || lower === "style";
}
function safeBindAttrValue(attribute, value) {
  if (!URL_BOUND_ATTRS.has(attribute.toLowerCase())) return value;
  const normalized = value.replace(BOUND_URL_NOISE, "").toLowerCase();
  if (/^[/\\]{2}/.test(normalized)) return "#";
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return value;
  return SAFE_BOUND_SCHEMES.has(`${scheme[1]}:`) ? value : "#";
}
function bindTextAttr(field) {
  return { [BIND_TEXT_ATTR]: field };
}
function bindAttrAttr(attribute, field) {
  if (isBindAttrRefused(attribute)) {
    throw new Error(`[${BIND_ATTR_ATTR}] "${attribute}" may not be bound to a signal`);
  }
  return { [BIND_ATTR_ATTR]: `${attribute}:${field}` };
}
function parseBindAttr(value) {
  const at = value.lastIndexOf(":");
  if (at <= 0 || at === value.length - 1) return null;
  return { attribute: value.slice(0, at), field: value.slice(at + 1) };
}

// src/ui/contracts/composite-contract.ts
var ACTIVE_COMPOSITE_ITEM = "data-composite-item-active";

// src/ui/contracts/naming.ts
var titleId = (rootId) => `${rootId}-title`;
var descriptionId = (rootId) => `${rootId}-description`;
var tabId = (panelId) => `${panelId}-tab`;
var triggerId = (popupId) => `${popupId}-trigger`;
function nameAttrs(naming) {
  if (naming.labelledby !== void 0) return { "aria-labelledby": naming.labelledby };
  if (naming.label !== void 0) return { "aria-label": naming.label };
  return {};
}

// src/ui/contracts/dialog-contract.ts
var DIALOG_SCOPE = "dialog";
var DIALOG_OPEN_MODAL_ATTR = "data-open-modal";
function dialogNameAttrs(id, naming) {
  const named = nameAttrs(naming);
  if (Object.keys(named).length > 0) return named;
  return naming.titled === true ? { "aria-labelledby": titleId(id) } : {};
}

// src/ui/contracts/htmx-contract.ts
var HTMX_TRUSTED_TYPES_POLICY = "forge-htmx";
var FAILURE_FRAGMENT_HEADER = "Forge-Failure-Fragment";

// src/ui/contracts/island-contract.ts
var ISLAND_STATE_ATTR = "data-island-state";
var ISLAND_STATE_KEY = ISLAND_STATE_ATTR.slice(5).replaceAll(/-(\w)/g, (_, c) => c.toUpperCase());

// src/ui/contracts/labels.ts
var LABEL_DEFAULTS = {
  alertDismiss: "Dismiss",
  breadcrumbs: "Breadcrumb",
  carouselDots: "Slides",
  carouselRoleDescription: "carousel",
  carouselSlide: "Slide",
  carouselSlideRoleDescription: "slide",
  carouselStrip: "Slides",
  dock: "Primary",
  filterReset: "Clear",
  navbarToggle: "Menu",
  numberFieldDecrement: "Decrement",
  numberFieldIncrement: "Increment",
  pagination: "Pagination",
  paginationEllipsis: "More pages",
  spinner: "Loading\u2026",
  themeDark: "Switch theme \u2014 currently dark",
  themeLight: "Switch theme \u2014 currently light",
  themeSystem: "Switch theme \u2014 currently system",
  toast: "Notifications",
  toastDismiss: "Dismiss notification",
  turnstileFallback: "The security challenge couldn't load. Please disable any ad or script blockers for this site and reload the page.",
  turnstileUnsupported: "This browser cannot run the security challenge. Please try again in a current version of Chrome, Edge, Firefox or Safari."
};
var STEP_STATE_LABELS = { complete: "Completed", current: "Current", upcoming: "Not started" };

// src/ui/contracts/state-attrs.ts
var STATE_ATTRS = {
  /** Present while a pressable trigger or toggle item is pressed. */
  pressed: "data-pressed",
  /** Present while a checkable control is checked. */
  checked: "data-checked",
  /** Present while a tab is the selected one. */
  selected: "data-selected",
  /** Present while the component is disabled. */
  disabled: "data-disabled",
  /** Present while the component holds a validation error. */
  invalid: "data-invalid",
  /** Present while the component is waiting on work it started — a submitting button, a loading field. */
  busy: "data-busy",
  /** Layout axis — `horizontal` or `vertical`. Valued, not a presence flag. */
  orientation: "data-orientation",
  /** Which side a popup sits on relative to its anchor. Valued. */
  side: "data-side",
  /** How a popup is aligned along that side. Valued. */
  align: "data-align",
  /** A component-local enum a stylesheet reads. Valued. Never a serialized payload — that is `data-island-state`. */
  state: "data-state",
  /** Present while a tooltip opened inside the warm window, so its enter skips the fade. */
  instant: "data-instant",
  /** Present from a dismissal until the element is removed — what the exit fade keys on. */
  dismissing: "data-dismissing"
};
function stateAttrs(state) {
  const attrs = {};
  if (state.pressed) attrs["data-pressed"] = "";
  if (state.checked) attrs["data-checked"] = "";
  if (state.selected) attrs["data-selected"] = "";
  if (state.disabled) attrs["data-disabled"] = "";
  if (state.invalid) attrs["data-invalid"] = "";
  if (state.busy) attrs["data-busy"] = "";
  if (state.orientation) attrs["data-orientation"] = state.orientation;
  if (state.side) attrs["data-side"] = state.side;
  if (state.align) attrs["data-align"] = state.align;
  if (state.state) attrs["data-state"] = state.state;
  return attrs;
}
function currentAttrs(current, kind = "page") {
  return { ...current ? { "aria-current": kind } : {}, ...stateAttrs({ selected: current }) };
}
function applyStateAttrs(el, state) {
  const next = stateAttrs(state);
  for (const key of Object.keys(state)) {
    if (state[key] === void 0) continue;
    const name = STATE_ATTRS[key];
    const value = next[name];
    if (value === void 0) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}

// src/ui/contracts/menu-contract.ts
var MENU_SCOPE = "menu";
var MENU_ITEM_SELECTOR = "[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']";
var MENU_RADIO_SELECTOR = "[role='menuitemradio']";
var MENU_KEEP_OPEN_ATTR = "data-menu-keep-open";
var MENU_GROUP_SELECTOR = "[role='group']";
var MENU_ITEM_CLASS = "flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer focus-ring hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground [&:is([role=menuitemcheckbox],[role=menuitemradio]):not([data-checked])]:before:size-4 [&:is([role=menuitemcheckbox],[role=menuitemradio])]:before:shrink-0 data-checked:before:mx-1.25 data-checked:before:mb-1 data-checked:before:h-2.5 data-checked:before:w-1.5 data-checked:before:rotate-45 rtl:data-checked:before:-scale-x-100 data-checked:before:border-e-2 data-checked:before:border-b-2 state-disabled";
function checkableAttrs(role, checked, disabled) {
  if (role !== "menuitemcheckbox" && role !== "menuitemradio") return {};
  const action = disabled ? {} : { "data-on-click": role === "menuitemcheckbox" ? "check" : "select" };
  return { "aria-checked": checked ? "true" : "false", ...stateAttrs({ checked }), ...action };
}
function menuItemAttrs(options = {}) {
  const { closes, role = "menuitem", disabled = false, checked = false } = options;
  return {
    role,
    "data-slot": role === "menuitem" ? "menu-item" : role === "menuitemcheckbox" ? "menu-checkbox-item" : "menu-radio-item",
    ...checkableAttrs(role, checked, disabled),
    ...disabled ? { "aria-disabled": "true" } : closes ? { command: "hide-popover", commandfor: closes } : {}
  };
}

// src/ui/contracts/input-format-contract.ts
var INPUT_FORMAT_SCOPE = "input-format";
var INPUT_FORMAT_ATTR = "data-format";
var SLOT = "#";
var WHITESPACE = /* @__PURE__ */ new Set([" ", "	", "\n", "\r", "\f", "\v"]);
var CONTENT = /^[\p{L}\p{N}]$/u;
function stripFormat(template, value) {
  const templateChars = [...template];
  const separators = new Set(templateChars.filter((char) => char !== SLOT && !CONTENT.test(char)));
  let cursor = 0;
  let significant = "";
  for (const char of value) {
    let at = cursor;
    while (at < templateChars.length && templateChars[at] !== SLOT && templateChars[at] !== char) at += 1;
    if (at < templateChars.length && templateChars[at] !== SLOT && templateChars[at] === char) {
      cursor = at + 1;
      continue;
    }
    if (WHITESPACE.has(char) || separators.has(char)) continue;
    cursor = at < templateChars.length ? at + 1 : templateChars.length;
    significant += char;
  }
  return significant;
}
function applyFormat(template, value) {
  const slots = [...template].filter((char) => char === SLOT).length;
  if (slots === 0) return value;
  const significant = [...stripFormat(template, value)];
  if (significant.length === 0) return "";
  if (significant.length > slots) return value;
  let formatted = "";
  let filled = 0;
  for (const char of template) {
    if (char === SLOT) {
      if (filled === significant.length) break;
      formatted += significant[filled];
      filled += 1;
      continue;
    }
    if (filled < significant.length) formatted += char;
  }
  return formatted;
}

// src/ui/contracts/navbar-contract.ts
var NAVBAR_SCOPE = "navbar";
var NAVBAR_FILTERS_EVENT = "navbar:filters";
var NAVBAR_DRAWER_ATTR = "data-navbar-drawer";

// src/ui/contracts/number-field-contract.ts
var NUMBER_FIELD_SCOPE = "number-field";

// src/ui/contracts/otp-input-contract.ts
var OTP_INPUT_SCOPE = "otp-input";
var OTP_LENGTH_ATTR = "data-otp-length";

// src/ui/contracts/overlay-contract.ts
var POPOVER_COORDS_ATTR = "data-coords";
var ANCHOR_X_PROPERTY = "--anchor-x";
var ANCHOR_Y_PROPERTY = "--anchor-y";
var POPOVER_SCOPE = "popover";
function invokerAttrs(popupId, kind) {
  return { "aria-controls": popupId, "aria-expanded": "false", "aria-haspopup": kind };
}

// src/ui/contracts/scope-events.ts
var SCOPE_EVENTS = ["click", "input", "change", "submit"];

// src/ui/contracts/scope-attrs.ts
function scopeAttrs(p) {
  const out = {};
  for (const event of SCOPE_EVENTS) {
    const key = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    const value = p[key];
    if (value !== void 0 && value !== "") out[`data-on-${event}`] = value;
  }
  return out;
}

// src/ui/contracts/slider-contract.ts
var SLIDER_SCOPE = "slider";

// src/ui/contracts/theme-toggle-contract.ts
var THEME_SCOPE = "theme";

// src/ui/contracts/toast-contract.ts
var TOAST_SCOPE = "toast";
var TOAST_DURATION_KEY = "duration";
var TOAST_CONTAINER_SCOPE = "toast-container";

// src/ui/contracts/vocabulary.ts
var TONES = ["neutral", "primary", "secondary", "destructive", "info", "success", "warning"];
var APPEARANCES = ["solid", "soft", "outline", "ghost", "link"];
var PRESENTATION_ATTRS = {
  /** The colour intent the surface carries — one of {@link TONES}. */
  tone: "data-tone",
  /** How that tone is painted — one of {@link APPEARANCES}. */
  appearance: "data-appearance",
  /** The control height, one of {@link Size}. */
  size: "data-size"
};
function presentationAttrs(presentation) {
  return {
    ...presentation.tone === void 0 ? {} : { "data-tone": presentation.tone },
    ...presentation.appearance === void 0 ? {} : { "data-appearance": presentation.appearance },
    ...presentation.size === void 0 ? {} : { "data-size": presentation.size }
  };
}

// src/ui/contracts/tabs-contract.ts
var TABS_SCOPE = "tabs";
var TAB_SELECTOR = "[role='tab']";
var TABLIST_SELECTOR = "[role='tablist']";
var TABS_MOUNTED_ATTR = "data-tabs-mounted";

// src/ui/contracts/toggle-contract.ts
var TOGGLE_GROUP_SCOPE = "toggle-group";
var TOGGLE_GROUP_ITEM_SELECTOR = "[data-slot~='toggle-group-input']";
var TOOLTIP_SCOPE = "tooltip";
var TOOLTIP_MOUNTED_ATTR = "data-tooltip-mounted";
var FILTER_SCOPE = "filter";

// src/ui/contracts/toolbar-contract.ts
var TOOLBAR_SCOPE = "toolbar";
var TOOLBAR_ITEM_ATTR = "data-toolbar-item";
var TOOLBAR_ITEM_SELECTOR = `[${TOOLBAR_ITEM_ATTR}]`;

// src/ui/contracts/turnstile-contract.ts
var TURNSTILE = {
  /** Root the controller mounts on, holding the frame and both messages. */
  widget: "turnstile",
  /** Box the controller renders Cloudflare's widget into, sized to its published dimensions under `appearance="always"`. */
  frame: "turnstile-frame",
  /** Inline message revealed when the challenge cannot load. */
  fallback: "turnstile-fallback",
  /** Inline message revealed when Turnstile does not support the visitor's browser at all. */
  unsupported: "turnstile-unsupported"
};
var TURNSTILE_SCOPE = "turnstile";
var TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
var TURNSTILE_SCRIPT_URL = `${TURNSTILE_SCRIPT_SRC}?render=explicit`;
var TURNSTILE_TRUSTED_TYPES_POLICY = "forge-turnstile";
var TURNSTILE_SCRIPT_TIMEOUT_MS = 1e4;
var TURNSTILE_EXECUTE_TIMEOUT_MS = 15e3;
var TURNSTILE_INTERACTIVE_TIMEOUT_MS = 6e4;
var TURNSTILE_ABANDONED_EVENT = "turnstile:abandoned";
var TURNSTILE_ACTION_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
var TURNSTILE_CDATA_PATTERN = /^[a-zA-Z0-9_-]{1,255}$/;
export {
  ACTIVE_COMPOSITE_ITEM,
  ALERT_SCOPE,
  ANCHOR_X_PROPERTY,
  ANCHOR_Y_PROPERTY,
  ANNOUNCER_REGION_SLOTS,
  ANNOUNCER_SCOPE,
  ANNOUNCE_BUSY_CHANNEL,
  ANNOUNCE_FAILURE_ATTR,
  ANNOUNCE_FAILURE_CHANNEL,
  ANNOUNCE_FORM_ERROR_CHANNEL,
  ANNOUNCE_LINGER_MS,
  ANNOUNCE_SETTLE_MS,
  ANNOUNCE_TOAST_CHANNEL,
  ANNOUNCE_TURNSTILE_CHANNEL,
  APPEARANCES,
  BIND_ATTR_ATTR,
  BIND_TEXT_ATTR,
  DIALOG_OPEN_MODAL_ATTR,
  DIALOG_SCOPE,
  FAILURE_FRAGMENT_HEADER,
  FILTER_SCOPE,
  HTMX_TRUSTED_TYPES_POLICY,
  INPUT_FORMAT_ATTR,
  INPUT_FORMAT_SCOPE,
  ISLAND_STATE_ATTR,
  ISLAND_STATE_KEY,
  LABEL_DEFAULTS,
  MENU_GROUP_SELECTOR,
  MENU_ITEM_CLASS,
  MENU_ITEM_SELECTOR,
  MENU_KEEP_OPEN_ATTR,
  MENU_RADIO_SELECTOR,
  MENU_SCOPE,
  NAVBAR_DRAWER_ATTR,
  NAVBAR_FILTERS_EVENT,
  NAVBAR_SCOPE,
  NUMBER_FIELD_SCOPE,
  OTP_INPUT_SCOPE,
  OTP_LENGTH_ATTR,
  POPOVER_COORDS_ATTR,
  POPOVER_SCOPE,
  PRESENTATION_ATTRS,
  SCOPE_EVENTS,
  SLIDER_SCOPE,
  STATE_ATTRS,
  STEP_STATE_LABELS,
  TABLIST_SELECTOR,
  TABS_MOUNTED_ATTR,
  TABS_SCOPE,
  TAB_SELECTOR,
  THEME_SCOPE,
  TOAST_CONTAINER_SCOPE,
  TOAST_DURATION_KEY,
  TOAST_SCOPE,
  TOGGLE_GROUP_ITEM_SELECTOR,
  TOGGLE_GROUP_SCOPE,
  TONES,
  TOOLBAR_ITEM_ATTR,
  TOOLBAR_ITEM_SELECTOR,
  TOOLBAR_SCOPE,
  TOOLTIP_MOUNTED_ATTR,
  TOOLTIP_SCOPE,
  TURNSTILE,
  TURNSTILE_ABANDONED_EVENT,
  TURNSTILE_ACTION_PATTERN,
  TURNSTILE_CDATA_PATTERN,
  TURNSTILE_EXECUTE_TIMEOUT_MS,
  TURNSTILE_INTERACTIVE_TIMEOUT_MS,
  TURNSTILE_SCOPE,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_SCRIPT_TIMEOUT_MS,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TRUSTED_TYPES_POLICY,
  URL_BOUND_ATTRS,
  applyFormat,
  applyStateAttrs,
  bindAttrAttr,
  bindTextAttr,
  currentAttrs,
  descriptionId,
  dialogNameAttrs,
  invokerAttrs,
  isBindAttrRefused,
  menuItemAttrs,
  nameAttrs,
  parseBindAttr,
  presentationAttrs,
  safeBindAttrValue,
  scopeAttrs,
  stateAttrs,
  stripFormat,
  tabId,
  titleId,
  triggerId
};
