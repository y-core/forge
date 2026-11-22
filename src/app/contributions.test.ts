import { describe, expect, it } from "bun:test";

import { createContributionSlots } from "./contributions";

interface Section {
  title: string;
}

interface AppSlots {
  home: Section;
  footer: string;
}

describe("createContributionSlots", () => {
  it("concatenates a slot across contributions in array order", () => {
    const first = { title: "First" };
    const second = { title: "Second" };
    const third = { title: "Third" };
    expect(createContributionSlots<AppSlots>([{ home: [first, second] }, { home: [third] }]).contributions("home")).toEqual([first, second, third]);
    expect(createContributionSlots<AppSlots>([{ home: [third] }, { home: [first, second] }]).contributions("home")).toEqual([third, first, second]);
  });

  it("keeps each slot apart from the others", () => {
    const slots = createContributionSlots<AppSlots>([{ home: [{ title: "Home" }] }, { footer: ["Legal"] }]);
    expect(slots.contributions("home")).toEqual([{ title: "Home" }]);
    expect(slots.contributions("footer")).toEqual(["Legal"]);
  });

  it("reads an unfilled slot as an empty list", () => {
    const slots = createContributionSlots<AppSlots>([]);
    expect(slots.contributions("home")).toEqual([]);
    expect(slots.contributions("unknown" as "home")).toEqual([]);
    expect(createContributionSlots<AppSlots>([{}, { footer: [] }]).contributions("footer")).toEqual([]);
  });

  it("refuses an unknown slot and an item of the wrong type at compile time", () => {
    // @ts-expect-error -- "sidebar" is not a slot of AppSlots
    const slots = createContributionSlots<AppSlots>([{ sidebar: [{ title: "Side" }] }]);
    // @ts-expect-error -- "sidebar" is not a slot of AppSlots
    slots.contributions("sidebar");
    // @ts-expect-error -- the home slot holds a Section, not a string
    createContributionSlots<AppSlots>([{ home: ["Home"] }]);
  });

  describe("one item object given twice", () => {
    it("throws, naming the slot, when two contributions give it", () => {
      const section = { title: "Twice" };
      expect(() => createContributionSlots<AppSlots>([{ home: [section] }, { home: [section] }])).toThrow(
        'createContributionSlots: the slot "home" is given one item twice.',
      );
    });

    it("throws when one contribution gives it twice", () => {
      const section = { title: "Twice" };
      expect(() => createContributionSlots<AppSlots>([{ home: [section, section] }])).toThrow(
        'createContributionSlots: the slot "home" is given one item twice.',
      );
    });

    it("accepts two equal but distinct objects", () => {
      const slots = createContributionSlots<AppSlots>([{ home: [{ title: "Same" }] }, { home: [{ title: "Same" }] }]);
      expect(slots.contributions("home")).toHaveLength(2);
    });

    it("accepts a repeated primitive, which has no identity", () => {
      expect(createContributionSlots<AppSlots>([{ footer: ["Legal"] }, { footer: ["Legal"] }]).contributions("footer")).toEqual(["Legal", "Legal"]);
    });
  });

  it("returns a frozen result whose every slot is frozen", () => {
    const slots = createContributionSlots<AppSlots>([{ home: [{ title: "Home" }] }]);
    expect(Object.isFrozen(slots)).toBe(true);
    expect(Object.isFrozen(slots.contributions("home"))).toBe(true);
    expect(Object.isFrozen(slots.contributions("footer"))).toBe(true);
    expect(() => (slots.contributions("home") as Section[]).push({ title: "Injected" })).toThrow(TypeError);
    expect(slots.contributions("home")).toEqual([{ title: "Home" }]);
  });

  it("keeps its slots when a caller later changes the arrays it passed", () => {
    const home = [{ title: "Home" }];
    const slots = createContributionSlots<AppSlots>([{ home }]);
    home.push({ title: "Late" });
    expect(slots.contributions("home")).toEqual([{ title: "Home" }]);
  });
});
