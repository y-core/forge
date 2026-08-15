import { describe, expect, it } from "bun:test";
import { mountTabs } from "./tabs";
import { type FakeElement, FakeEvent, fakeTree } from "./test-dom";

/** A tab set whose tabs are anchors, exactly as `Tabs.Tab` renders them. */
function tabs(options: { activation?: string; selected?: number } = {}) {
  const { doc, el } = fakeTree();
  const { activation = "automatic", selected = 0 } = options;
  const root = el("DIV", { "data-slot": "tabs", "data-activation": activation });
  const list = el("DIV", { role: "tablist" });
  const made = ["a", "b", "c"].map((id, i) => {
    const tab = el("A", { role: "tab", "aria-controls": `p-${id}`, "aria-selected": String(i === selected), href: `#p-${id}` });
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

  it("does not select a tab marked aria-disabled", () => {
    const { root, tabs: list } = tabs();
    list[2]?.setAttribute("aria-disabled", "true");
    mountTabs(root as never);

    fire(list[2] as FakeElement, "focusin");

    expect(selection(list)).toEqual(["true", "false", "false"]);
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
