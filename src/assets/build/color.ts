/**
 * Pure OKLCh → sRGB colour conversion and CSS colour-literal parsing.
 *
 * No dependencies — implements the OKLab transform from Björn Ottosson's spec plus
 * CSS Color 4 chroma-reduction gamut mapping. Used by the cursor bake step to turn
 * design-token colour literals into concrete hex values embedded in cursor SVGs.
 */

const GAMUT_EPSILON = 1e-4;

function srgbGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const lHat = l + 0.3963377774 * a + 0.2158037573 * b;
  const mHat = l - 0.1055613458 * a - 0.0638541728 * b;
  const sHat = l - 0.0894841775 * a - 1.291485548 * b;

  const lc = lHat ** 3;
  const mc = mHat ** 3;
  const sc = sHat ** 3;

  const r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;
  return [r, g, bl];
}

function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

function clip01(c: number): number {
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

/**
 * Convert OKLCh to sRGB [r,g,b] in [0,1].
 *
 * `l` is 0–1, `c` is chroma (0–0.4 typical), `h` is hue in degrees. Applies CSS Color 4
 * chroma-reduction gamut mapping (binary search on chroma) when the colour falls outside
 * the sRGB gamut, clipping any residual out-of-bounds channels. @public
 */
export function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const linear = oklabToLinearSrgb(l, a, b);
  if (inGamut(linear)) {
    return [srgbGamma(clip01(linear[0])), srgbGamma(clip01(linear[1])), srgbGamma(clip01(linear[2]))];
  }

  if (l >= 1) return [1, 1, 1];
  if (l <= 0) return [0, 0, 0];

  let minC = 0;
  let maxC = c;
  for (let i = 0; i < 20; i++) {
    const mid = (minC + maxC) / 2;
    const midA = mid * Math.cos(hRad);
    const midB = mid * Math.sin(hRad);
    if (inGamut(oklabToLinearSrgb(l, midA, midB))) {
      minC = mid;
    } else {
      maxC = mid;
    }
  }

  const finalA = minC * Math.cos(hRad);
  const finalB = minC * Math.sin(hRad);
  const mapped = oklabToLinearSrgb(l, finalA, finalB);
  return [srgbGamma(clip01(mapped[0])), srgbGamma(clip01(mapped[1])), srgbGamma(clip01(mapped[2]))];
}

/** Convert [r,g,b] in [0,1] to a `#rrggbb` hex string. @public */
export function toHex(rgb: [number, number, number]): string {
  const hex = rgb
    .map((c) => {
      const byte = Math.round(clip01(c) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
  return `#${hex}`;
}

function parseNumber(token: string): number {
  return token.endsWith("%") ? Number.parseFloat(token.slice(0, -1)) / 100 : Number.parseFloat(token);
}

function parseHex(value: string): [number, number, number] | null {
  const match = value.match(/^#([0-9a-fA-F]{6})$/);
  if (!match?.[1]) return null;
  const int = Number.parseInt(match[1], 16);
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/^rgba?\(([^)]*)\)$/i);
  if (!match?.[1]) return null;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter((p) => p.length > 0)
    .slice(0, 3)
    .map((p) => Number.parseFloat(p) / 255);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseOklchArgs(value: string): { l: number; c: number; h: number } | null {
  const match = value.match(/^oklch\(([^)]*)\)$/i);
  if (!match?.[1]) return null;
  const parts = match[1].split(/[\s,]+/).filter((p) => p.length > 0);
  if (parts.length < 3) return null;
  const l = parseNumber(parts[0]!);
  const c = Number.parseFloat(parts[1]!);
  const h = Number.parseFloat(parts[2]!);
  if (Number.isNaN(l) || Number.isNaN(c) || Number.isNaN(h)) return null;
  return { l, c, h };
}

function splitColorMix(inner: string): [string, string] | null {
  // Split the two colour arguments at the top-level comma, respecting nested parens.
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseMixOperand(operand: string): { color: string; pct: number | null } {
  const match = operand.match(/^(.*?)(?:\s+([\d.]+)%)?$/s);
  if (!match?.[1]) return { color: operand.trim(), pct: null };
  return { color: match[1].trim(), pct: match[2] !== undefined ? Number.parseFloat(match[2]) : null };
}

function interpolateHue(h1: number, h2: number, t: number): number {
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  return h1 + delta * t;
}

function parseColorMix(value: string): [number, number, number] | null {
  const match = value.match(/^color-mix\(\s*in\s+(oklch|srgb)\s*,\s*([\s\S]*)\)$/i);
  if (!match?.[1] || !match?.[2]) return null;
  const space = match[1].toLowerCase();
  const args = splitColorMix(match[2]);
  if (!args) return null;

  const first = parseMixOperand(args[0]);
  const second = parseMixOperand(args[1]);
  const p1 = first.pct ?? (second.pct !== null ? 100 - second.pct : 50);
  const t = 1 - p1 / 100;

  if (space === "oklch") {
    const o1 = parseOklchArgs(normalizeOklchLiteral(first.color));
    const o2 = parseOklchArgs(normalizeOklchLiteral(second.color));
    if (!o1 || !o2) return null;
    const l = o1.l + (o2.l - o1.l) * t;
    const c = o1.c + (o2.c - o1.c) * t;
    const h = interpolateHue(o1.h, o2.h, t);
    return oklchToSrgb(l, c, h);
  }

  const c1 = parseColor(first.color);
  const c2 = parseColor(second.color);
  if (!c1 || !c2) return null;
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

function normalizeOklchLiteral(value: string): string {
  return value.trim();
}

/**
 * Parse a CSS colour literal to normalized [r,g,b] in [0,1].
 *
 * Supports `oklch(L C H)` (with `%` on L), `rgb()`/`rgba()` (0–255 args), `#rrggbb` hex,
 * and `color-mix(in oklch|srgb, c1 p%, c2)`. Returns null for unrecognized formats. @public
 */
export function parseColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return parseHex(trimmed);
  if (/^oklch\(/i.test(trimmed)) {
    const args = parseOklchArgs(trimmed);
    return args ? oklchToSrgb(args.l, args.c, args.h) : null;
  }
  if (/^rgba?\(/i.test(trimmed)) return parseRgb(trimmed);
  if (/^color-mix\(/i.test(trimmed)) return parseColorMix(trimmed);
  return null;
}
