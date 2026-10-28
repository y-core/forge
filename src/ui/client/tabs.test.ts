import { describe, expect, it } from "bun:test";

import { TAB_SELECTOR, TABS_MOUNTED_ATTR } from "../contracts/tabs-contract";
import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { mountTabs } from "./tabs";

const TAB_ROLE = /\[role='([^']+)'\]/.exec(TAB_SELECTOR)?.[1] ?? TAB_SELECTOR;

function tabs(options: { activation?: string; selected?: number } = {}) {
  const { doc, el } = fakeTree();
  const { activation = "automatic", selected = 0 } = options;
  const root = el("DIV", { "data-slot": "tabs", "data-scope": "tabs", "data-activation": activation });
  const list = el("DIV", { role: "tablist" });
  root.append(list);
  const made = ["a", "b", "c"].map((id, i) => {
    const tab = el("A", { role: TAB_ROLE, "aria-controls": `p-${id}`, "aria-selected": String(i === selected), href: `#p-${id}` });
    const panel = el("DIV", { role: "tabpanel", id: `p-${id}` });
    panel.hidden = i !== selected;
    if (i === selected) tab.setAttribute("data-selected", "");
    else panel.setAttribute("hidden", "");
    list.append(tab);
    root.append(panel);
    return { tab, panel };
  });
  doc.root.append(root);
  return { doc, el, root, list, tabs: made.map((m) => m.tab), panels: made.map((m) => m.panel) };
}

const fire = (el: FakeElement, type: string) => {
  const event = new FakeEvent(type);
  el.dispatchEvent(event);
  return event;
};

const selection = (list: FakeElement[]) => list.map((el) => el.getAttribute("aria-selected"));

describe("mountTabs", () => {
  it("moves the styling hook with the ARIA state on every tab it repaints", () => {
    const { root, tabs: list } = tabs();
    mountTabs(root as never);

    fire(list[2] as FakeElement, "focusin");

    expect(list.map((el) => [el.getAttribute("aria-selected"), el.hasAttribute("data-selected")])).toEqual([
      ["false", false],
      ["false", false],
      ["true", true],
    ]);
  });

  it("marks the tab set mounted, which is what retires the :target fallback", () => {
    const { root } = tabs();

    mountTabs(root as never);

    expect(root.hasAttribute("data-tabs-mounted")).toBe(true);
  });

  it("clears the marker on dispose, so the fallback comes back with the controller gone", () => {
    const { root } = tabs();

    mountTabs(root as never)();

    expect(root.hasAttribute("data-tabs-mounted")).toBe(false);
  });

  it("writes TABS_MOUNTED_ATTR on mount and takes it off again on dispose", () => {
    const { root } = tabs();

    const dispose = mountTabs(root as never);
    const mounted = root.getAttribute(TABS_MOUNTED_ATTR);
    dispose();

    expect({ mounted, disposed: root.getAttribute(TABS_MOUNTED_ATTR) }).toEqual({ mounted: "", disposed: null });
  });

  it("drives the tabs TAB_SELECTOR names, which every fixture tab matches", () => {
    const { root, tabs: list } = tabs();
    mountTabs(root as never);

    fire(list[2] as FakeElement, "focusin");

    expect({ matched: list.map((tab) => tab.matches(TAB_SELECTOR)), selection: selection(list) }).toEqual({
      matched: [true, true, true],
      selection: ["false", "false", "true"],
    });
  });

  it("hides every panel but the selected one on mount, whatever revealed it before", () => {
    const { root, panels } = tabs({ selected: 1 });
    (panels[2] as FakeElement).hidden = false;
    (panels[1] as FakeElement).hidden = true;

    mountTabs(root as never);

    expect(panels.map((panel) => panel.hidden)).toEqual([true, false, true]);
  });

  it("selects on focus under automatic activation, moving both halves of the state", () => {
    const { root, tabs: list, panels } = tabs();
    mountTabs(root as never);

    fire(list[2] as FakeElement, "focusin");

    expect(selection(list)).toEqual(["false", "false", "true"]);
    expect(panels.map((panel) => panel.hidden)).toEqual([true, true, false]);
  });

  it("waits for a click under manual activation, ignoring focus alone", () => {
    const { root, tabs: list } = tabs({ activation: "manual" });
    mountTabs(root as never);

    fire(list[2] as FakeElement, "focusin");
    expect(selection(list)).toEqual(["true", "false", "false"]);

    fire(list[2] as FakeElement, "click");
    expect(selection(list)).toEqual(["false", "false", "true"]);
  });

  it("prevents the anchor's default so activation does not push a history entry", () => {
    const { root, tabs: list } = tabs();
    mountTabs(root as never);

    expect(fire(list[1] as FakeElement, "click").defaultPrevented).toBe(true);
  });

  it("reaches a tab marked aria-disabled without selecting it", () => {
    const { root, tabs: list } = tabs();
    list[2]?.setAttribute("aria-disabled", "true");
    mountTabs(root as never);

    fire(list[2] as FakeElement, "focusin");

    expect(selection(list)).toEqual(["true", "false", "false"]);
    expect(list[2]?.getAttribute("aria-selected")).toBe("false");
  });

  it("stops selecting once disposed", () => {
    const { root, tabs: list } = tabs();
    mountTabs(root as never)();

    fire(list[2] as FakeElement, "focusin");

    expect(selection(list)).toEqual(["true", "false", "false"]);
  });

  it("reads the activation mode from the root when the caller names none", () => {
    const { root, tabs: list } = tabs({ activation: "manual" });
    mountTabs(root as never);

    fire(list[1] as FakeElement, "focusin");

    expect(selection(list)).toEqual(["true", "false", "false"]);
  });

  it("selecting an outer tab leaves a nested Tabs' selection and panels alone", () => {
    const { el, root, tabs: outer, panels } = tabs();
    const innerRoot = el("DIV", { "data-slot": "tabs", "data-scope": "tabs" });
    const innerList = el("DIV", { role: "tablist" });
    const [x, y] = ["x", "y"].map((id, i) => {
      const tab = el("A", { role: TAB_ROLE, "aria-controls": `p-${id}`, "aria-selected": String(i === 0), href: `#p-${id}` });
      if (i === 0) tab.setAttribute("data-selected", "");
      const panel = el("DIV", { role: "tabpanel", id: `p-${id}` });
      panel.hidden = i !== 0;
      innerList.append(tab);
      innerRoot.append(panel);
      return { tab, panel };
    }) as [{ tab: FakeElement; panel: FakeElement }, { tab: FakeElement; panel: FakeElement }];
    innerRoot.append(innerList);
    (panels[0] as FakeElement).append(innerRoot);
    mountTabs(root as never);
    mountTabs(innerRoot as never);

    fire(outer[1] as FakeElement, "focusin");

    expect({
      selected: x.tab.getAttribute("aria-selected"),
      hook: x.tab.hasAttribute("data-selected"),
      shown: x.panel.hidden,
      other: y.panel.hidden,
    }).toEqual({ selected: "true", hook: true, shown: false, other: true });
  });

  it("drives its own tablist, not a nested Tabs' tablist that precedes it", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-slot": "tabs", "data-scope": "tabs" });
    const innerRoot = el("DIV", { "data-slot": "tabs", "data-scope": "tabs" });
    const innerList = el("DIV", { role: "tablist" });
    const [x, y] = ["x", "y"].map((id, i) => {
      const tab = el("A", { role: TAB_ROLE, "aria-controls": `p-${id}`, "aria-selected": String(i === 0), href: `#p-${id}` });
      const panel = el("DIV", { role: "tabpanel", id: `p-${id}` });
      panel.hidden = i !== 0;
      innerList.append(tab);
      innerRoot.append(panel);
      return tab;
    }) as [FakeElement, FakeElement];
    innerRoot.append(innerList);
    root.append(innerRoot);
    const list = el("DIV", { role: "tablist" });
    const [, b] = ["a", "b"].map((id, i) => {
      const tab = el("A", { role: TAB_ROLE, "aria-controls": `p-${id}`, "aria-selected": String(i === 0), href: `#p-${id}` });
      const panel = el("DIV", { role: "tabpanel", id: `p-${id}` });
      panel.hidden = i !== 0;
      list.append(tab);
      root.append(panel);
      return tab;
    }) as [FakeElement, FakeElement];
    root.append(list);
    doc.root.append(root);
    mountTabs(root as never);

    fire(y, "focusin");
    fire(b, "focusin");

    expect({ x: x.getAttribute("aria-selected"), y: y.getAttribute("aria-selected"), b: b.getAttribute("aria-selected") }).toEqual({
      x: "true",
      y: "false",
      b: "true",
    });
  });
});

describe("mountTabs — handing the tab stop back", () => {
  it("keeps a tablist in the tab sequence when every tab is disabled and none is selected", () => {
    const { root, list, tabs: rows } = tabs();
    for (const tab of rows) {
      tab.setAttribute("aria-selected", "false");
      tab.setAttribute("aria-disabled", "true");
    }
    mountTabs(root as never);

    list.dispatchEvent(new FakeEvent("focusout"));

    expect(rows.filter((tab) => tab.tabIndex === 0).length).toBe(1);
  });

  it("writes no tab stop outside the list when the tablist itself holds no tabs", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-slot": "tabs" });
    const list = el("DIV", { role: "tablist" });
    const stray = el("A", { role: TAB_ROLE, href: "#p-a" });
    stray.tabIndex = -1;
    root.append(list);
    root.append(stray);
    doc.root.append(root);
    mountTabs(root as never);

    list.dispatchEvent(new FakeEvent("focusout"));

    expect(stray.tabIndex).toBe(-1);
  });
});

describe("mountTabs — disposing", () => {
  const counts = (el: FakeElement): number => [...el.listeners.values()].reduce((total, list) => total + list.length, 0);

  it("removes every listener it and the roving ring put on the tab list", () => {
    const { root, list } = tabs();

    mountTabs(root as never)();

    expect(counts(list)).toBe(0);
  });

  it("stops swallowing a tab click once disposed, so the anchor works with no script again", () => {
    const { root, tabs: rows } = tabs();
    mountTabs(root as never)();

    const click = new FakeEvent("click", { target: rows[1] });
    (rows[1] as FakeElement).dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
  });

  it("selects on Space under manual activation while mounted, swallowing the key", () => {
    const { root, tabs: rows } = tabs({ activation: "manual" });
    const dispose = mountTabs(root as never);

    const space = new FakeEvent("keydown", { key: " ", target: rows[1] });
    (rows[1] as FakeElement).dispatchEvent(space);
    dispose();

    expect({ selection: selection(rows), spaceSwallowed: space.defaultPrevented }).toEqual({
      selection: ["false", "true", "false"],
      spaceSwallowed: true,
    });
  });

  it("selects nothing under manual activation once disposed, neither on Space nor on a click", () => {
    const { root, tabs: rows } = tabs({ activation: "manual" });
    mountTabs(root as never)();

    const space = new FakeEvent("keydown", { key: " ", target: rows[1] });
    (rows[1] as FakeElement).dispatchEvent(space);
    fire(rows[2] as FakeElement, "click");

    expect({ selection: selection(rows), spaceSwallowed: space.defaultPrevented }).toEqual({
      selection: ["true", "false", "false"],
      spaceSwallowed: false,
    });
  });

  it("swallows that same click while mounted, which is what the disposal undoes", () => {
    const { root, tabs: rows } = tabs();
    mountTabs(root as never);

    const click = new FakeEvent("click", { target: rows[1] });
    (rows[1] as FakeElement).dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
  });
});
