import { describe, expect, it } from "bun:test";

import { checkMenuNaming, triggeredPopupIds, triggerTargets, validateMenuNaming } from "./menu-naming";

const messages = (file: string, source: string) => validateMenuNaming(file, source).flatMap((finding) => finding.detail ?? []);

describe("triggeredPopupIds", () => {
  it("reads a literal id from the JSX spelling and from the call spelling alike", () => {
    const source = `<Menu.Popup triggered id='a' coords>x</Menu.Popup>; Menu.Popup({ triggered: true, id: "b", children: rows });`;
    expect(triggeredPopupIds(source)).toEqual(["a", "b"]);
  });

  it("passes over a popup named literally, which asserts no trigger at all", () => {
    expect(triggeredPopupIds(`<Menu.Popup label='Context actions' id='a'>x</Menu.Popup>`)).toEqual([]);
  });

  // A trigger may be rendered from the same prop the popup's id comes from, so the rule is a net
  // over the literal case rather than a proof over every case.
  it("skips a non-literal id rather than failing it", () => {
    expect(triggeredPopupIds(`<Menu.Popup triggered id={id} side='inline-end'>x</Menu.Popup>`)).toEqual([]);
  });

  // Children hold popups of their own, and a scan that ran past them would read the inner popup's
  // id as the outer one's — reporting a submenu that is perfectly well paired.
  it("stops at the children, so a nested popup's id is not read as its parent's", () => {
    const source = `<Menu.Popup triggered id='outer'><Menu.Popup triggered id='inner'>x</Menu.Popup></Menu.Popup>`;
    expect(triggeredPopupIds(source)).toEqual(["outer", "inner"]);
  });
});

describe("triggerTargets", () => {
  it("collects both trigger kinds, in either spelling", () => {
    const source = `<Menu.Trigger for='a'>A</Menu.Trigger>; Menu.SubmenuTrigger({ for: "b", children: "B" });`;
    expect({ literal: [...triggerTargets(source).literal].sort(), opaque: triggerTargets(source).opaque }).toEqual({
      literal: ["a", "b"],
      opaque: false,
    });
  });

  it("calls a file opaque when a trigger aims through a value rather than a literal", () => {
    expect(triggerTargets(`<Menu.Trigger for={id}>A</Menu.Trigger>`).opaque).toBe(true);
  });
});

describe("validateMenuNaming", () => {
  it("fails a triggered popup no trigger in the file targets, naming the id it promised", () => {
    expect(messages("src/ui/show/components.tsx", `<Menu.Popup triggered id='show-context-menu-popup' coords>x</Menu.Popup>`)).toEqual([
      '`triggered` on id "show-context-menu-popup" — nothing in this file renders "show-context-menu-popup-trigger"; use `label` instead',
    ]);
  });

  it("passes a triggered popup whose trigger sits beside it", () => {
    expect(validateMenuNaming("f.tsx", `<Menu.Trigger for='m'>Open</Menu.Trigger><Menu.Popup triggered id='m'>x</Menu.Popup>`)).toEqual([]);
  });

  // A trigger rendered from a prop or by a local helper is one the check cannot follow, and a file
  // holding one is left unjudged rather than reported on evidence the check does not have.
  it("judges nothing in a file whose triggers aim through a value", () => {
    const source = `const t = (id) => Menu.Trigger({ for: id, children: "Open" }); Menu.Popup({ triggered: true, id: "m", children: rows });`;
    expect(validateMenuNaming("f.ts", source)).toEqual([]);
  });

  it("passes a submenu popup reached through a SubmenuTrigger", () => {
    const source = `Menu.SubmenuTrigger({ for: "recent-menu", children: "Recent" }); Menu.Popup({ triggered: true, id: "recent-menu", children: rows });`;
    expect(validateMenuNaming("f.ts", source)).toEqual([]);
  });
});

describe("checkMenuNaming", () => {
  it("refuses to report green over a directory holding no module", () => {
    const outcome = checkMenuNaming({ root: process.cwd(), sources: ["no-such-directory"] });
    expect({ ok: outcome.ok, message: outcome.findings[0]?.message }).toEqual({
      ok: false,
      message: "`no-such-directory` matched no module — refusing to report a green menu-naming gate that scanned nothing",
    });
  });

  it("passes over this repository's own source", () => {
    expect(checkMenuNaming({ root: process.cwd(), sources: ["src"] }).ok).toBe(true);
  });
});
