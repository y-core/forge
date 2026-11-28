import { describe, expect, it } from "bun:test";

import * as authWeb from "./auth/web/mod";
import * as pdf from "./render/pdf/mod";
import * as chrome from "./ui/chrome/mod";
import * as controls from "./ui/controls/mod";
import * as core from "./ui/core/mod";
import * as server from "./ui/server/mod";

const BARRELS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "auth/web": authWeb,
  "render/pdf": pdf,
  "ui/chrome": chrome,
  "ui/controls": controls,
  "ui/core": core,
  "ui/server": server,
};

function components(path: string, key: string, value: unknown): [string, number][] {
  if (typeof value !== "function" || !/^[A-Z]/.test(key) || /^class\b/.test(Function.prototype.toString.call(value))) return [];
  const members = Object.entries(value).flatMap(([member, part]) => components(`${path}.${member}`, member, part));
  return [[path, value.length], ...members];
}

const FOUND = Object.entries(BARRELS).flatMap(([barrel, exports]) =>
  Object.entries(exports).flatMap(([key, value]) => components(`${barrel} ${key}`, key, value)),
);

describe("every component a barrel publishes", () => {
  it("is found, so the arity assertion below is made against something", () => {
    expect(FOUND.length).toBeGreaterThan(100);
  });

  it("takes one props object and no second positional argument", () => {
    expect(FOUND.filter(([, arity]) => arity > 1).map(([name]) => name)).toEqual([]);
  });

  it("would report a component declared with a second positional argument", () => {
    const Table = (_props: object, _children: unknown) => null;
    expect(components("render/pdf Table", "Table", Table)).toEqual([["render/pdf Table", 2]]);
  });
});
