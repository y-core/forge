import { describe, expect, it } from "bun:test";
import { oklchToSrgb, parseColor, toHex } from "./color";

describe("oklchToSrgb()", () => {
  it("converts emerald-600 to a green-ish sRGB hex", () => {
    const hex = toHex(oklchToSrgb(0.596, 0.145, 163.225));
    expect(hex).toHaveLength(7);
    expect(hex.startsWith("#")).toBe(true);
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    expect(r).toBeLessThan(0x40);
    expect(g).toBeGreaterThan(0x70);
    expect(b).toBeGreaterThan(0x40);
  });

  it("converts pure black", () => {
    expect(toHex(oklchToSrgb(0, 0, 0))).toBe("#000000");
  });

  it("converts pure white", () => {
    expect(toHex(oklchToSrgb(1, 0, 0))).toBe("#ffffff");
  });

  it("clips an out-of-gamut high-chroma colour without throwing", () => {
    const hex = toHex(oklchToSrgb(0.5, 0.4, 30));
    expect(hex).toHaveLength(7);
    expect(hex.startsWith("#")).toBe(true);
    expect(/^#[0-9a-f]{6}$/.test(hex)).toBe(true);
  });
});

describe("parseColor()", () => {
  it("parses percentage-L oklch identically to fractional L", () => {
    const pct = parseColor("oklch(59.6% 0.145 163.225)");
    const frac = oklchToSrgb(0.596, 0.145, 163.225);
    expect(pct).not.toBeNull();
    expect(pct![0]).toBeCloseTo(frac[0], 6);
    expect(pct![1]).toBeCloseTo(frac[1], 6);
    expect(pct![2]).toBeCloseTo(frac[2], 6);
  });

  it("parses #rrggbb hex", () => {
    const rgb = parseColor("#059669");
    expect(rgb).not.toBeNull();
    expect(rgb![0]).toBeCloseTo(5 / 255, 6);
    expect(rgb![1]).toBeCloseTo(150 / 255, 6);
    expect(rgb![2]).toBeCloseTo(105 / 255, 6);
  });

  it("parses rgb() identically to the equivalent hex", () => {
    const rgb = parseColor("rgb(5, 150, 105)");
    const hex = parseColor("#059669");
    expect(rgb).not.toBeNull();
    expect(hex).not.toBeNull();
    expect(rgb![0]).toBeCloseTo(hex![0], 6);
    expect(rgb![1]).toBeCloseTo(hex![1], 6);
    expect(rgb![2]).toBeCloseTo(hex![2], 6);
  });

  it("returns null for unrecognized formats", () => {
    expect(parseColor("not-a-color")).toBeNull();
    expect(parseColor("hsl(120 50% 50%)")).toBeNull();
  });

  it("color-mix(in oklch, white 50%, black) produces a mid-gray", () => {
    const rgb = parseColor("color-mix(in oklch, oklch(1 0 0) 50%, oklch(0 0 0))");
    expect(rgb).not.toBeNull();
    const hex = toHex(rgb!);
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(0x40);
    expect(r).toBeLessThan(0xd0);
    expect(g).toBe(r);
    expect(b).toBe(r);
  });
});

describe("toHex()", () => {
  it("formats [0, 1, 0.5] as #00ff80", () => {
    expect(toHex([0, 1, 0.5])).toBe("#00ff80");
  });
});
