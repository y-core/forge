import { describe, expect, it } from "bun:test";

import { suppressesSwap } from "./failure-swap";

const MARKED = new Headers({ "Forge-Failure-Fragment": "1" });
const UNMARKED = new Headers({ "content-type": "text/html" });

describe("suppressesSwap", () => {
  const cases: Array<{ status: number; unmarked: boolean; marked: boolean }> = [
    { status: 100, unmarked: false, marked: false },
    { status: 200, unmarked: false, marked: false },
    { status: 204, unmarked: false, marked: false },
    { status: 304, unmarked: false, marked: false },
    { status: 400, unmarked: false, marked: false },
    { status: 403, unmarked: false, marked: false },
    { status: 422, unmarked: false, marked: false },
    { status: 429, unmarked: false, marked: false },
    { status: 499, unmarked: false, marked: false },
    { status: 500, unmarked: true, marked: false },
    { status: 502, unmarked: true, marked: false },
    { status: 503, unmarked: true, marked: false },
    { status: 599, unmarked: true, marked: false },
  ];

  for (const { status, unmarked, marked } of cases) {
    it(unmarked ? `suppresses an unmarked ${status} and keeps a marked one's swap` : `keeps the swap of a ${status}, marked or not`, () => {
      expect({ unmarked: suppressesSwap(status, UNMARKED), marked: suppressesSwap(status, MARKED) }).toEqual({ unmarked, marked });
    });
  }

  it("reads the marker under any casing of its name, as a header name is matched", () => {
    const names = ["Forge-Failure-Fragment", "forge-failure-fragment", "FORGE-FAILURE-FRAGMENT"];

    expect(names.map((name) => suppressesSwap(503, new Headers({ [name]: "1" })))).toEqual([false, false, false]);
  });

  it("treats the marker as present whatever its value, so a 5xx sending any value swaps", () => {
    const values = ["1", "0", "", "true"];

    expect(values.map((value) => suppressesSwap(500, new Headers({ "Forge-Failure-Fragment": value })))).toEqual([false, false, false, false]);
  });

  it("suppresses a 5xx whose header only resembles the marker", () => {
    const names = ["Forge-Failure-Fragments", "X-Forge-Failure-Fragment", "Forge-Failure"];

    expect(names.map((name) => suppressesSwap(500, new Headers({ [name]: "1" })))).toEqual([true, true, true]);
  });

  it("swaps a 5xx an app marks on its own, since the marker is read from the response and not from who built it", () => {
    const appMade = new Response("<p>Down for maintenance.</p>", {
      status: 503,
      headers: { "content-type": "text/html", "Forge-Failure-Fragment": "1" },
    });

    expect(suppressesSwap(appMade.status, appMade.headers)).toBe(false);
  });
});
