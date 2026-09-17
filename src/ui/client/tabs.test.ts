import { describe, expect, it } from "bun:test";

import { TAB_SELECTOR, TABS_MOUNTED_ATTR } from "../contracts/tabs-contract";
import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { mountTabs } from "./tabs";

const TAB_ROLE = /\[role='([^']+)'\]/.exec(TAB_SELECTOR)?.[1] ?? TAB_SELECTOR;

/** A tab set whose tabs are anchors, exactly as `Tabs.Tab` renders them. */
function tabs(options: { activation?: string; selected?: number } = {}) {
  const { doc, el } = fakeTree();
  const { activation = "automatic", selected = 0 } = options;
  const root = el("DIV", { "data-slot": "tabs", "data-activation": activation });
  const list = el("DIV", { role: "tablist" });
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
  root.append(list);
  doc.root.append(root);
  return { doc, root, list, tabs: made.map((m) => m.tab), panels: made.map((m) => m.panel) };
}

const fire = (el: FakeElement, type: string) => {
  const event = new FakeEvent(type);
  el.dispatchEvent(event);
  return event;
};

const selection = (list: FakeElement[]) => list.map((el) => el.getAttribute("aria-selected"));

describe("mountTabs", () => {
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

  // An aria-disabled tab stays reachable and is inert on arrival — it is focused here, and the
  // selection does not move to it. A tab that had left the ring could not be focused at all.
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
});

// `tabs.test.ts` fires only `focusin`, which is the automatic-activation listener alone. The click
// listener and the roving ring are removed by the same disposer and neither is reached that way.
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

  it("swallows that same click while mounted, which is what the disposal undoes", () => {
    const { root, tabs: rows } = tabs();
    mountTabs(root as never);

    const click = new FakeEvent("click", { target: rows[1] });
    (rows[1] as FakeElement).dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
  });
});
