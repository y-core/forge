import { describe, expect, it } from "bun:test";

import { barrelComponents, COVERAGE_COMPONENTS } from "./components";

const CORE_SAMPLE = { Button: () => null, FIELD_CLASSES: "x", cn: () => "", Label: function () {} };

describe("barrelComponents", () => {
  it("keeps only the capitalised functions a barrel publishes", () => {
    expect(barrelComponents({ core: CORE_SAMPLE })).toEqual([
      { barrel: "core", component: "Button", key: "core/Button" },
      { barrel: "core", component: "Label", key: "core/Label" },
    ]);
  });

  it("reports a name two barrels share once per barrel", () => {
    const Input = () => null;
    expect(barrelComponents({ core: { Input }, controls: { Input } }).map((entry) => entry.key)).toEqual(["controls/Input", "core/Input"]);
  });

  it("sorts across barrels by the qualified key", () => {
    expect(barrelComponents({ server: { A: () => null }, chrome: { Z: () => null } }).map((entry) => entry.key)).toEqual(["chrome/Z", "server/A"]);
  });

  it("widens with the barrel when a component is added", () => {
    expect(barrelComponents({ core: { ...CORE_SAMPLE, Extra: () => null } }).map((entry) => entry.key)).toEqual([
      "core/Button",
      "core/Extra",
      "core/Label",
    ]);
  });

  it("returns nothing for a barrel that publishes no component", () => {
    expect(barrelComponents({ core: {} })).toEqual([]);
  });

  it("orders keys by code unit, so an uppercase letter sorts before a lowercase one whatever the locale", () => {
    expect(barrelComponents({ core: { Aa: () => null, AB: () => null } }).map((entry) => entry.key)).toEqual(["core/AB", "core/Aa"]);
  });

  it("freezes the list it returns and every entry in it", () => {
    const found = barrelComponents({ core: CORE_SAMPLE, server: { Flash: () => null } });

    expect([Object.isFrozen(found), ...found.map((entry) => Object.isFrozen(entry))]).toEqual([true, true, true, true]);
  });
});

describe("COVERAGE_COMPONENTS", () => {
  it("draws from exactly the chrome, controls, core and server barrels", () => {
    expect([...new Set(COVERAGE_COMPONENTS.map((entry) => entry.barrel))].sort()).toEqual(["chrome", "controls", "core", "server"]);
  });

  it("holds the published components and none of the constants or helpers beside them", () => {
    const keys = new Set<string>(COVERAGE_COMPONENTS.map((entry) => entry.key));
    expect(
      Object.fromEntries(
        [
          "core/Button",
          "core/Input",
          "controls/Input",
          "core/Toolbar",
          "chrome/Toolbar",
          "server/Flash",
          "core/FIELD_LABEL_CLASSES",
          "core/cn",
          "chrome/THEME_ATTR",
          "server/createFlash",
        ].map((key) => [key, keys.has(key)]),
      ),
    ).toEqual({
      "core/Button": true,
      "core/Input": true,
      "controls/Input": true,
      "core/Toolbar": true,
      "chrome/Toolbar": true,
      "server/Flash": true,
      "core/FIELD_LABEL_CLASSES": false,
      "core/cn": false,
      "chrome/THEME_ATTR": false,
      "server/createFlash": false,
    });
  });

  it("qualifies each component by its barrel, one key per entry", () => {
    expect(COVERAGE_COMPONENTS.filter((entry) => entry.key !== `${entry.barrel}/${entry.component}`)).toEqual([]);
    expect(new Set(COVERAGE_COMPONENTS.map((entry) => entry.key)).size).toBe(COVERAGE_COMPONENTS.length);
  });

  it("cannot be mutated by a consumer", () => {
    expect(Object.isFrozen(COVERAGE_COMPONENTS)).toBe(true);
    expect(Object.isFrozen(COVERAGE_COMPONENTS[0])).toBe(true);
  });

  it("freezes every entry, not only the first", () => {
    expect(COVERAGE_COMPONENTS.filter((entry) => !Object.isFrozen(entry))).toEqual([]);
  });
});
