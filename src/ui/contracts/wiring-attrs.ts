import { BIND_ATTR_ATTR, BIND_TEXT_ATTR } from "./bind-contract";
import { ACTIVE_COMPOSITE_ITEM } from "./composite-contract";
import { DIALOG_OPEN_MODAL_ATTR } from "./dialog-contract";
import { INPUT_FORMAT_ATTR } from "./input-format-contract";
import { NAVBAR_DRAWER_ATTR } from "./navbar-contract";
import { POPOVER_COORDS_ATTR } from "./overlay-contract";
import { TABS_MOUNTED_ATTR } from "./tabs-contract";
import { TOOLTIP_MOUNTED_ATTR } from "./toggle-contract";
import { TOOLBAR_ITEM_ATTR } from "./toolbar-contract";

// Read by tests only: a runtime reference would retain the whole table in every bundle that spreads
// a hook, the cost `state-attrs.ts` documents. The five `contracts/theme/` names are literal because
// `ui/contracts` is LEAF and may not import its own subnamespace; the spec holds them to it.
/** Every `data-*` name that addresses structure or wires a controller, with the reason it exists. @internal */
export const WIRING_ATTRS: Record<string, string> = {
  "data-slot": "the addressable-element token itself",
  "data-scope": "names the browser scope that resumes this island",
  "data-ref": "the handle a scope's own setup addresses an element by",
  "data-field": "the form field a bound control reads and writes",
  [INPUT_FORMAT_ATTR]: "the input mask a bound control applies",
  "data-content": "the tooltip text a controller lifts into its popup",
  "data-position": "where a fixed container sits on the viewport",
  "data-placement": "where a decoration sits relative to its host",
  "data-snap": "which edge a carousel slide settles on",
  "data-label-position": "which side of a control its label sits on",
  "data-responsive": "whether a field collapses by width",
  "data-multiple": "whether a toggle group is checkboxes or radios",
  "data-activation": "whether a tab set activates on focus or on click",
  "data-value": "the value a bound control publishes to its scope",
  "data-compact": "whether a toolbar flyout drops its width floor",

  "data-sitekey": "Cloudflare's, passed to the Turnstile widget verbatim",
  "data-load": "when the Turnstile script is fetched",
  "data-challenge": "Cloudflare's, passed to the Turnstile widget verbatim",
  "data-action": "Cloudflare's, passed to the Turnstile widget verbatim",
  "data-cdata": "Cloudflare's, passed to the Turnstile widget verbatim",
  "data-response-field-name": "Cloudflare's, passed to the Turnstile widget verbatim",
  "data-language": "Cloudflare's, passed to the Turnstile widget verbatim",
  "data-tabindex": "Cloudflare's, passed to the Turnstile widget verbatim",

  [DIALOG_OPEN_MODAL_ATTR]: "asks the client runtime to call showModal(), which has no markup spelling",
  [ACTIVE_COMPOSITE_ITEM]: "marks the one item holding a composite's roving tab stop",
  [TOOLBAR_ITEM_ATTR]: "marks a toolbar's roving-focus candidates",
  [BIND_ATTR_ATTR]: "which attribute a signal writes",
  [BIND_TEXT_ATTR]: "which signal a text node reads",
  [TABS_MOUNTED_ATTR]: "marks a tab set its controller has taken over",
  [TOOLTIP_MOUNTED_ATTR]: "marks a tooltip its controller has taken over",
  [NAVBAR_DRAWER_ATTR]: "arms the drawer controller on a narrow viewport",
  [POPOVER_COORDS_ATTR]: "the anchor rect a popover is positioned against",

  "data-filter": "the auth tokens an element is shown for",
  "data-filters": "the active auth-token set a demo publishes",
  "data-filter-item": "an element the filter controller shows or hides",

  "data-theme-preference": "the stored light/dark preference a page boots with",
  "data-preset-picker": "the control naming which fitted preset the dials sit on",
  "data-swatch": "one painted step in a generated ramp",
  "data-scale-row": "one family's row of steps in the scale readout",
  "data-hex": "the resolved hex a swatch publishes for its readout",
  "data-readout": "a live value the customiser writes as the dials move",
  "data-pair": "one audited foreground/background pair in the contrast table",
  "data-ratio": "the measured ratio a pair publishes",
  "data-scheme-output": "the generated scheme file the page prints",
  "data-share-url": "the query string the whole customiser state round-trips through",
  "data-copy-target": "what a copy button copies",
  "data-copy-label": "the copy button's resting label",
  "data-copy-status": "where a copy button reports success",

  "data-decoration": "Link's text decoration — deliberately not the `appearance` emphasis axis",
  "data-as": "FieldLayout.Legend's type scale — deliberately not the `appearance` emphasis axis",
};

/** `data-on-*` is one name per action and `data-hx-*` is htmx's own, so both are matched by prefix. @internal */
export const WIRING_PREFIXES: readonly string[] = ["data-on-", "data-hx-"];
