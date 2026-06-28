import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { repeat } from "./repeat";
import { createSignal } from "./signal";

interface FakeEl {
  tag: string;
  children: FakeEl[];
  replaceChildren(...nodes: FakeEl[]): void;
}

function makeEl(tag: string): FakeEl {
  const el: FakeEl = {
    tag,
    children: [],
    replaceChildren(...nodes) {
      el.children = [...nodes];
    },
  };
  return el;
}

type Item = { id: string; label: string };

function makeOpts(container: FakeEl, source: () => readonly Item[], overrides?: { update?: (el: FakeEl, item: Item) => void }) {
  const base = {
    container: container as unknown as HTMLElement,
    each: source,
    key: (item: Item) => item.id,
    render: (item: Item) => makeEl(item.id) as unknown as HTMLElement,
  };
  if (overrides?.update) {
    const cb = overrides.update;
    return { ...base, update: (el: HTMLElement, item: Item) => cb(el as unknown as FakeEl, item) };
  }
  return base;
}

describe("repeat()", () => {
  let container: FakeEl;

  beforeEach(() => {
    container = makeEl("container");
  });

  it("renders children for the initial list on call", () => {
    const items = createSignal<readonly Item[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    repeat(makeOpts(container, () => items.value));
    expect(container.children.map((c) => c.tag)).toEqual(["a", "b"]);
  });

  it("reflects added items when the signal updates", () => {
    const items = createSignal<readonly Item[]>([{ id: "a", label: "A" }]);
    repeat(makeOpts(container, () => items.value));
    items.value = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    expect(container.children.map((c) => c.tag)).toEqual(["a", "b"]);
  });

  it("reuses the same node object for a key across updates", () => {
    const items = createSignal<readonly Item[]>([{ id: "a", label: "A" }]);
    repeat(makeOpts(container, () => items.value));
    const firstNode = container.children[0];
    items.value = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    expect(container.children[0]).toBe(firstNode);
  });

  it("calls update for a reused key", () => {
    const updates: string[] = [];
    const items = createSignal<readonly Item[]>([{ id: "a", label: "A" }]);
    repeat(makeOpts(container, () => items.value, { update: (_, item) => updates.push(item.label) }));
    items.value = [{ id: "a", label: "A2" }];
    expect(updates).toEqual(["A2"]);
  });

  it("removes items dropped from the list", () => {
    const items = createSignal<readonly Item[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    repeat(makeOpts(container, () => items.value));
    items.value = [{ id: "a", label: "A" }];
    expect(container.children.map((c) => c.tag)).toEqual(["a"]);
  });

  it("reorders nodes to match the new list order", () => {
    const items = createSignal<readonly Item[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    repeat(makeOpts(container, () => items.value));
    const [nodeA, nodeB] = container.children;
    items.value = [
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ];
    expect(container.children[0]).toBe(nodeB);
    expect(container.children[1]).toBe(nodeA);
  });

  it("does not throw when update is omitted and a key is reused", () => {
    const items = createSignal<readonly Item[]>([{ id: "a", label: "A" }]);
    expect(() => {
      repeat(makeOpts(container, () => items.value));
      items.value = [{ id: "a", label: "A2" }];
    }).not.toThrow();
  });

  it("stops reconciling after dispose", () => {
    const items = createSignal<readonly Item[]>([{ id: "a", label: "A" }]);
    const dispose = repeat(makeOpts(container, () => items.value));
    dispose();
    items.value = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    expect(container.children).toHaveLength(1);
  });

  it("warns on duplicate keys and keeps last", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const items = createSignal<readonly Item[]>([
      { id: "dup", label: "First" },
      { id: "dup", label: "Second" },
    ]);
    repeat(makeOpts(container, () => items.value));
    expect(warnSpy).toHaveBeenCalled();
    const [firstCall] = warnSpy.mock.calls;
    expect(String(firstCall?.[0])).toContain("dup");
    warnSpy.mockRestore();
  });
});
