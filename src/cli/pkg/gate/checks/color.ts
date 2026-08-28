// The 0.03928 threshold is WCAG SC 1.4.3's own, not sRGB's 0.04045; this is a conformance number,
// so the stated procedure is reproduced rather than corrected.
/** WCAG relative luminance of a `#rrggbb` colour. @public */
export function relativeLuminance(hex: string): number {
  const channel = (index: number): number => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** The order-independent WCAG contrast ratio between two opaque `#rrggbb` colours, 1–21. @public */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// An alpha component is rejected rather than dropped: a translucent colour has no single contrast
// ratio, and measuring it at full opacity reports a number wrong in the safe-looking direction.
/** Parses `oklch(50.5% 0.213 27.518)` into its three numbers, or `null` when the value is not one. @public */
export function parseOklch(value: string): { l: number; c: number; h: number } | null {
  const match = /^oklch\(\s*([0-9.]+)(%?)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/i.exec(value.trim());
  if (match === null) return null;
  const [, rawL = "", percent = "", rawC = "", rawH = ""] = match;
  const l = Number(rawL);
  const c = Number(rawC);
  const h = Number(rawH);
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) return null;
  return { l: percent === "%" ? l / 100 : l, c, h };
}

// Per-channel clipping, not CSS Color 4 chroma reduction: browsers clip, and a conformance
// measurement must match what is painted. `ui/contracts/color.ts` gamut-maps because it generates.
/** Converts OKLCh to the `#rrggbb` a browser paints. @public */
export function oklchToPaintedHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
  const channel = (value: number): string => {
    const gamma = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, gamma)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(channel).join("")}`;
}
