import { oklabToLinearSrgb, srgbGamma, toSrgbGamut } from "../../contracts/theme/color";

function clip01(c: number): number {
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

/** Converts OKLCh to sRGB [r,g,b] in [0,1], gamut-mapping by chroma reduction. @internal */
export function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const mapped = toSrgbGamut(l, c, h);
  const hRad = (mapped.h * Math.PI) / 180;
  const linear = oklabToLinearSrgb(mapped.l, mapped.c * Math.cos(hRad), mapped.c * Math.sin(hRad));
  return [srgbGamma(clip01(linear[0])), srgbGamma(clip01(linear[1])), srgbGamma(clip01(linear[2]))];
}

/** Converts [r,g,b] or [r,g,b,a] in [0,1] to the shortest canonical hex string. @public */
export function toHex(rgb: [number, number, number] | [number, number, number, number]): string {
  const byte = (c: number) =>
    Math.round(clip01(c) * 255)
      .toString(16)
      .padStart(2, "0");
  const [r, g, b, a = 1] = rgb;
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
}

function parseNumber(token: string): number {
  return token.endsWith("%") ? Number.parseFloat(token.slice(0, -1)) / 100 : Number.parseFloat(token);
}

function parseHex(value: string): [number, number, number, number] | null {
  // Tailwind v4 emits short forms (`--color-white: #fff`), so each nibble is doubled before parsing.
  const short = value.match(/^#([0-9a-fA-F]{3})([0-9a-fA-F])?$/);
  const expanded = short?.[1] ? `#${[...short[1], ...(short[2] ?? "")].map((n) => `${n}${n}`).join("")}` : value;
  const match = expanded.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  if (!match?.[1]) return null;
  const int = Number.parseInt(match[1], 16);
  const alpha = match[2] !== undefined ? Number.parseInt(match[2], 16) / 255 : 1;
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255, alpha];
}

function parseRgb(value: string): [number, number, number, number] | null {
  const match = value.match(/^rgba?\(([^)]*)\)$/i);
  if (!match?.[1]) return null;
  const parts = match[1].split(/[\s,/]+/).filter((p) => p.length > 0);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map((p) => Number.parseFloat(p) / 255);
  const [c0 = Number.NaN, c1 = Number.NaN, c2 = Number.NaN] = channels;
  const alpha = parts[3] !== undefined ? parseNumber(parts[3]) : 1;
  if (Number.isNaN(c0) || Number.isNaN(c1) || Number.isNaN(c2) || Number.isNaN(alpha)) return null;
  return [c0, c1, c2, alpha];
}

function parseOklchArgs(value: string): { l: number; c: number; h: number; alpha: number } | null {
  const match = value.match(/^oklch\(([^)]*)\)$/i);
  if (!match?.[1]) return null;
  const [body = "", alphaToken] = match[1].split("/").map((s) => s.trim());
  const parts = body.split(/[\s,]+/).filter((p) => p.length > 0);
  if (parts.length < 3) return null;
  const [p0 = "", p1 = "", p2 = ""] = parts;
  const l = parseNumber(p0);
  const c = Number.parseFloat(p1);
  const h = Number.parseFloat(p2);
  const alpha = alphaToken !== undefined && alphaToken.length > 0 ? parseNumber(alphaToken) : 1;
  if (Number.isNaN(l) || Number.isNaN(c) || Number.isNaN(h) || Number.isNaN(alpha)) return null;
  return { l, c, h, alpha };
}

function splitColorMix(inner: string): [string, string] | null {
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

function parseColorMix(value: string): [number, number, number, number] | null {
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
    const [r, g, b] = oklchToSrgb(l, c, h);
    return [r, g, b, o1.alpha + (o2.alpha - o1.alpha) * t];
  }

  const c1 = parseColor(first.color);
  const c2 = parseColor(second.color);
  if (!c1 || !c2) return null;
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t, c1[3] + (c2[3] - c1[3]) * t];
}

function normalizeOklchLiteral(value: string): string {
  return value.trim();
}

/** Parses a CSS colour literal to normalized [r,g,b,a] in [0,1], or null. @public */
export function parseColor(value: string): [number, number, number, number] | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return parseHex(trimmed);
  if (/^oklch\(/i.test(trimmed)) {
    const args = parseOklchArgs(trimmed);
    if (!args) return null;
    const [r, g, b] = oklchToSrgb(args.l, args.c, args.h);
    return [r, g, b, args.alpha];
  }
  if (/^rgba?\(/i.test(trimmed)) return parseRgb(trimmed);
  if (/^color-mix\(/i.test(trimmed)) return parseColorMix(trimmed);
  return null;
}
