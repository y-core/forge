import { describe, expect, it } from "bun:test";

import { BIND_ATTR_ATTR, BIND_TEXT_ATTR } from "./bind-contract";
import { ACTIVE_COMPOSITE_ITEM } from "./composite-contract";
import { DIALOG_OPEN_MODAL_ATTR } from "./dialog-contract";
import { INPUT_FORMAT_ATTR } from "./input-format-contract";
import { NAVBAR_DRAWER_ATTR } from "./navbar-contract";
import { POPOVER_COORDS_ATTR } from "./overlay-contract";
import { TABS_MOUNTED_ATTR } from "./tabs-contract";
import { COPY_LABEL_ATTR, COPY_STATUS_ATTR, COPY_TARGET_ATTR, HEX_ATTR, SCALE_ROW_ATTR } from "./theme/theme-contract";
import { TOOLTIP_MOUNTED_ATTR } from "./toggle-contract";
import { TOOLBAR_ITEM_ATTR } from "./toolbar-contract";
import { WIRING_ATTRS, WIRING_PREFIXES } from "./wiring-attrs";

const EXPECTED = [
  "data-action",
  "data-activation",
  "data-as",
  "data-bind-attr",
  "data-bind-text",
  "data-cdata",
  "data-challenge",
  "data-compact",
  "data-composite-item-active",
  "data-content",
  "data-coords",
  "data-copy-label",
  "data-copy-status",
  "data-copy-target",
  "data-decoration",
  "data-field",
  "data-filter",
  "data-filter-item",
  "data-filters",
  "data-format",
  "data-hex",
  "data-label-position",
  "data-language",
  "data-load",
  "data-multiple",
  "data-navbar-drawer",
  "data-open-modal",
  "data-pair",
  "data-placement",
  "data-position",
  "data-preset-picker",
  "data-ratio",
  "data-readout",
  "data-ref",
  "data-response-field-name",
  "data-responsive",
  "data-scale-row",
  "data-scheme-output",
  "data-scope",
  "data-share-url",
  "data-sitekey",
  "data-slot",
  "data-snap",
  "data-swatch",
  "data-tabindex",
  "data-tabs-mounted",
  "data-theme-preference",
  "data-toolbar-item",
  "data-tooltip-mounted",
  "data-value",
];

describe("WIRING_ATTRS — one declaration of the wiring vocabulary", () => {
  it("holds exactly the union both sweeps used to restate, less the five stale names", () => {
    expect(Object.keys(WIRING_ATTRS).sort()).toEqual(EXPECTED);
  });

  it("gives every name a non-empty reason, so the reason travels with the name", () => {
    expect(Object.entries(WIRING_ATTRS).filter(([, reason]) => reason.trim() === "")).toEqual([]);
  });

  it("takes each already-declared name from its constant rather than restating it", () => {
    const declared = [
      BIND_ATTR_ATTR,
      BIND_TEXT_ATTR,
      ACTIVE_COMPOSITE_ITEM,
      DIALOG_OPEN_MODAL_ATTR,
      INPUT_FORMAT_ATTR,
      NAVBAR_DRAWER_ATTR,
      POPOVER_COORDS_ATTR,
      TABS_MOUNTED_ATTR,
      TOOLTIP_MOUNTED_ATTR,
      TOOLBAR_ITEM_ATTR,
    ];

    expect(declared.filter((name) => !(name in WIRING_ATTRS))).toEqual([]);
  });

  it("keeps the five theme-declared names in step with their constants across the leaf boundary", () => {
    expect([COPY_TARGET_ATTR, COPY_LABEL_ATTR, COPY_STATUS_ATTR, SCALE_ROW_ATTR, HEX_ATTR].filter((name) => !(name in WIRING_ATTRS))).toEqual([]);
  });

  it("matches `data-on-*` and htmx's `data-hx-*` by prefix, since neither is one name", () => {
    expect(WIRING_PREFIXES).toEqual(["data-on-", "data-hx-"]);
  });
});
