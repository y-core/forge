import { describe, expect, it } from "bun:test";
import { controlsReadout } from "./controls-demo-contract";

describe("controlsReadout", () => {
  const cases: { input: unknown; expected: string }[] = [
    { input: true, expected: "on" },
    { input: false, expected: "off" },
    { input: 40, expected: "40" },
    { input: 0, expected: "0" },
    { input: "mm", expected: "mm" },
    { input: "", expected: "(empty)" },
    { input: ["olives", "basil"], expected: "olives, basil" },
    { input: [], expected: "(none)" },
  ];

  for (const { input, expected } of cases) {
    it(`formats ${JSON.stringify(input)} as "${expected}"`, () => {
      expect(controlsReadout(input)).toBe(expected);
    });
  }
});
