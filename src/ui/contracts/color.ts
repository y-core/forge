/**
 * OKLCh ↔ sRGB conversion, WCAG contrast, and the scale generator behind the theme customiser.
 *
 * ## Why this exists beside `src/assets/build/color.ts`
 *
 * That module already implements the same OKLab transform and the same CSS Color 4 chroma-reduction
 * gamut mapping, and duplicating a capability is against the standing rule. It is duplicated anyway,
 * knowingly, because the namespace graph forbids the alternative: `EDGES` in
 * `scripts/namespace-graph.ts` grants `assets/build → assets` (type-only) and `ui/client →
 * ui/contracts`, and neither module can reach the other without an edge that would wire the browser
 * runtime to the build pipeline. `ui/contracts` is the one place both `ui/client` and `ui/show` can
 * see, so the customiser's maths lives here and the cursor-bake step's stays there.
 *
 * The duplication is **paid for rather than merely declared**: `color.test.ts` imports both modules
 * and asserts they agree across a sample of the oklch space. Tests are excluded from the
 * namespace-graph parse, so the test crosses the boundary the source cannot, and silent drift
 * between the two becomes a failing gate rather than a discrepancy nobody is looking for.
 *
 * ## What a generated scheme is, and why it can be generated at all
 *
 * A forge scheme file is exactly `--gray-1…12` plus `--gray-a1…a12` in a `:root`/`.dark` pair —
 * see the header of `theme-neutral.css`. Every shipped scheme uses **one lightness ramp** and
 * differs only in chroma and hue, which is the property that lets a scheme be added without
 * re-pinning a single contrast row. This module takes that literally: {@link GRAY_RAMP} is that
 * ramp, extracted from `theme-neutral.css`, and hue and chroma are the only free parameters.
 *
 * Because lightness is fixed, contrast is decidable before a dial is touched — which is the whole
 * reason a customiser built on these levers can promise conformance, and a customiser built on free
 * colour pickers cannot.
 */

// ── Types ────────────────────────────────────────────────────────────────────────────────────────

/** The two blocks a scheme file declares. Matches `Mode` in `scripts/contrast-parse.ts`. @public */
export type Mode = "light" | "dark";

/**
 * A twelve-position scale, as a tuple rather than an array.
 *
 * `noUncheckedIndexedAccess` is on, so `string[]` would make every `scale[8]` a `string | undefined`
 * and push a non-null assertion into each of the dozen call sites that read a step by number. The
 * tuple carries the length in the type, which is also the honest statement: a scale with eleven
 * steps is not a shorter scale, it is not a scale. @public
 */
export type Scale<T> = readonly [T, T, T, T, T, T, T, T, T, T, T, T];

/** A colour in OKLCh: lightness 0–1, chroma (0–0.4 in practice), hue in degrees. @public */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/**
 * The fixed half of a scale: what each step's lightness is, and how much of the chroma dial it
 * takes.
 *
 * `chroma` holds **normalised weights in 0–1**, not chroma values — the shape of the ramp, with the
 * dial supplying its peak. Splitting it this way is what makes one number a legible lever: a scheme
 * is "this shape at this strength", so a slider moves the whole ramp coherently instead of moving
 * twelve independent decisions. @public
 */
export interface Ramp {
  readonly lightness: Scale<number>;
  readonly chroma: Scale<number>;
}

/** The two free parameters. `hue` is degrees; `chroma` is the ramp's **peak** chroma. @public */
export interface Dials {
  readonly hue: number;
  readonly chroma: number;
}

// ── The ramps ────────────────────────────────────────────────────────────────────────────────────

/**
 * The neutral scale's lightness, and the tint shape every scheme applies over it.
 *
 * `lightness` is `theme-neutral.css` measured step for step — the same twelve values `theme-gray`,
 * `theme-slate` and `theme-stone` sit on, agreeing to within 0.001. **Light steps 1 and 2 are
 * non-monotone on purpose**: forge swaps them so `--card` reads as raised above `--background`
 * without the semantic layer needing a `.dark` twin. That asymmetry belongs to the scale, so it is
 * reproduced here rather than corrected.
 *
 * `chroma` is `theme-slate.css` normalised by its own peak. Slate is the reference because it is the
 * most saturated scheme shipped, and therefore the one whose shape is actually *measured*: at
 * stone's peak of 0.0123 a single 8-bit quantisation step is a third of the whole signal, so its
 * apparent shape — and its wildly swinging per-step hue — is mostly rounding. The two shapes are
 * genuinely different curves: in light, tint grows with darkness and peaks at step 11; in dark it is
 * near-flat through step 10 and then falls away, because 11 and 12 are text and text does not want
 * the tint.
 * @public
 */
export const GRAY_RAMP: Readonly<Record<Mode, Ramp>> = {
  light: {
    lightness: [0.9821, 0.9911, 0.9551, 0.931, 0.9067, 0.8853, 0.8514, 0.7921, 0.6434, 0.61, 0.5032, 0.2435],
    chroma: [0.076, 0.063, 0.19, 0.279, 0.358, 0.425, 0.52, 0.675, 0.922, 0.964, 1, 0.921],
  },
  dark: {
    lightness: [0.1776, 0.2134, 0.252, 0.285, 0.3132, 0.3485, 0.4017, 0.4891, 0.5382, 0.5829, 0.7699, 0.9491],
    chroma: [0.902, 0.905, 0.901, 0.924, 0.925, 0.949, 0.963, 0.961, 1, 0.98, 0.697, 0.226],
  },
};

/**
 * The accent scale's ramp — a different curve, and it has to be.
 *
 * Taken from Radix Colors' `indigo` / `indigoDark`, measured the same way `GRAY_RAMP` is measured
 * from `theme-neutral.css`. It is **not** the gray ramp with more chroma, and the gap is not
 * marginal: light step 9 sits at 0.5438 against gray's 0.6434. Step 9 is Radix's "solid background"
 * — the one step a brand colour is actually *seen* as — and a saturated hue held up at gray-9's
 * lightness reads washed out rather than brand-coloured. Reusing the gray ramp would make the whole
 * preview look subtly wrong with the cause three layers down, so the two ramps stay separate.
 *
 * Steps 9 and 10 carry nearly all the chroma in both modes, which is the same statement from the
 * other side: the solid band is where an accent lives, and 11 and 12 taper because they are text.
 *
 * Light steps 1 and 2 need no swap. Indigo already runs 0.9943 then 0.9823 — lighter first — which
 * is the orientation forge produces for gray by swapping, so the raised-card relationship holds
 * here by inheritance rather than by intervention.
 *
 * ## Step 9 departs from indigo, on purpose, and it is the one value that does
 *
 * Radix's indigo 9 sits at **0.5438 in both modes** — accents do not invert their solid the way a
 * neutral does, because a brand colour has to stay the same brand colour in dark mode. That has a
 * consequence forge cannot absorb: `--<hue>-contrast` must then be near-white in *both* modes, and
 * forge's only near-white dark step is `--gray-12` at `#eeeeee`. On indigo 9 that measures
 * **4.49:1** — under 1.4.3's 4.5 floor, and it reaches 4.51 only on the one-byte-different value
 * the dark ramp happens to generate. A pair astride its floor by a rounding artifact is not a pair
 * to pin.
 *
 * So step 9 is **0.52** here rather than 0.5438, which restores real margin — 5.48:1 in light and
 * 4.97:1 in dark — at a lightness difference no one will identify by eye. This is the one place the
 * ramp is forge's rather than Radix's, and it is worth being explicit that it is a *choice*: an
 * accent ramp is not an obligation to reproduce a particular hue's authoring, and 9 is the step
 * whose whole job is to be a fill that text sits on legibly.
 *
 * `color.test.ts` still checks the reconstruction against indigo, with step 9 excluded from the
 * byte-exact assertion and named there for this reason.
 * @public
 */
export const ACCENT_RAMP: Readonly<Record<Mode, Ramp>> = {
  light: {
    // Step 10 moves down with 9, keeping indigo's own 9→10 gap of 0.0332. Step 10 is the *hover* on
    // step 9's solid, so it is the gap rather than the absolute value that has a job; darkening 9
    // alone would have left the two 0.009 apart and made the hover invisible.
    lightness: [0.9943, 0.9823, 0.9609, 0.9346, 0.9019, 0.862, 0.8062, 0.7309, 0.52, 0.4868, 0.5092, 0.3126],
    // Step 9's weight is 1 rather than indigo's 0.978, so that a single chroma dial produces the
    // **same** step 9 in both modes. Radix reaches that by giving each mode its own peak (0.1954 and
    // 0.1910) and scaling to match; one shared dial cannot, so the weights are matched instead. This
    // is not cosmetic — `--accent-contrast` is near-white in both modes precisely because the solid
    // does not change between them, and a one-byte drift would make that claim approximate.
    chroma: [0.007, 0.042, 0.087, 0.159, 0.241, 0.346, 0.448, 0.575, 1, 1, 0.883, 0.439],
  },
  dark: {
    lightness: [0.1909, 0.2094, 0.2716, 0.3185, 0.3625, 0.4033, 0.4491, 0.5021, 0.52, 0.5653, 0.7759, 0.9108],
    chroma: [0.129, 0.158, 0.369, 0.495, 0.546, 0.582, 0.629, 0.715, 1, 0.92, 0.596, 0.224],
  },
};

/**
 * How far each chroma dial travels.
 *
 * `gray` is 0.1 — a little over twice `theme-slate.css`'s 0.045, which is the most saturated
 * neutral forge ships. The ceiling is not a guess: sweeping every hue at every audited pair, the
 * tightest pair (`--input`, bound by 1.4.11's 3:1 floor) clears at **3.19:1** there, against 3.33:1
 * for a purely achromatic scale. Chroma erodes the margin because WCAG luminance is not OKLCh
 * lightness — but it erodes it slowly, and the whole audit still clears at 0.2. So this is a taste
 * boundary with headroom behind it rather than a safety boundary, and `color.test.ts` sweeps the
 * range to keep it that way.
 *
 * `accent` is 0.2, around Radix indigo's peak of 0.195. Above that most hues are outside sRGB at
 * these lightnesses and {@link oklchToHex} maps them back in, so the top of the dial would move a
 * number without moving a colour. Some hues — greens and yellows especially — run out of gamut well
 * before the ceiling, which is a property of sRGB rather than of the dial: no single maximum is
 * right for every hue, and clamping visibly is better than a per-hue limit that moves under the
 * user's hand. @public
 */
export const CHROMA_MAX: Readonly<Record<"gray" | "accent", number>> = { gray: 0.1, accent: 0.2 };

// ── OKLCh ↔ sRGB ─────────────────────────────────────────────────────────────────────────────────

const GAMUT_EPSILON = 1e-4;

function srgbGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function srgbLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function clip01(c: number): number {
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

function inGamut(rgb: readonly [number, number, number]): boolean {
  return rgb.every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

function byte(c: number): string {
  return Math.round(clip01(c) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * OKLCh → `#rrggbb`.
 *
 * Out-of-gamut colours are brought in by **reducing chroma at constant lightness and hue**, binary
 * searched, as CSS Color 4 specifies — not by clipping channels, which shifts the hue and would make
 * a hue dial stop behaving like a hue dial at the top of its chroma range. Any residual overshoot
 * from the search's tolerance is clipped afterwards.
 *
 * Mirrors `oklchToSrgb` in `src/assets/build/color.ts`; see this file's header for why that is two
 * implementations rather than one, and `color.test.ts` for what holds them together. @public
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const cos = Math.cos(hRad);
  const sin = Math.sin(hRad);

  const direct = oklabToLinearSrgb(l, c * cos, c * sin);
  if (inGamut(direct)) return `#${byte(srgbGamma(direct[0]))}${byte(srgbGamma(direct[1]))}${byte(srgbGamma(direct[2]))}`;
  if (l >= 1) return "#ffffff";
  if (l <= 0) return "#000000";

  let lo = 0;
  let hi = c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearSrgb(l, mid * cos, mid * sin))) lo = mid;
    else hi = mid;
  }
  const mapped = oklabToLinearSrgb(l, lo * cos, lo * sin);
  return `#${byte(srgbGamma(mapped[0]))}${byte(srgbGamma(mapped[1]))}${byte(srgbGamma(mapped[2]))}`;
}

/** The three sRGB channels of a `#rrggbb` literal, as 0–1. Throws on any other shape. */
function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (match?.[1] === undefined) throw new Error(`not a #rrggbb colour: ${hex}`);
  const int = Number.parseInt(match[1], 16);
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

/**
 * `#rrggbb` → OKLCh, the inverse of {@link oklchToHex}.
 *
 * Hue is meaningless as chroma approaches zero and this does not pretend otherwise — it returns
 * whatever `atan2` yields, normalised to 0–360. A caller reading the hue of a near-achromatic colour
 * is reading quantisation noise, which is exactly what the shipped stone scheme's steps 1–3
 * demonstrate: three colours one byte apart report hues 72° apart. @public
 */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex).map(srgbLinear) as [number, number, number];
  const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const b2 = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;

  const hue = (Math.atan2(b2, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b2), h: hue < 0 ? hue + 360 : hue };
}

// ── WCAG ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * WCAG relative luminance of a `#rrggbb` colour.
 *
 * The transfer function here is WCAG 2.x's own — the 0.03928 threshold from the SC 1.4.3 definition,
 * **not** sRGB's 0.04045 that {@link hexToOklch} uses. They differ in the fourth decimal and the
 * difference is invisible, but this is a conformance number: the ratios pinned in
 * `TOKEN_CONTRACT` were measured by the procedure WCAG states, so this reproduces that procedure
 * rather than an equivalent one. @public
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two opaque `#rrggbb` colours, 1–21.
 *
 * Order-independent, as the definition is — `(lighter + 0.05) / (darker + 0.05)`. @public
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── The generator ────────────────────────────────────────────────────────────────────────────────

const STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

function twelve<T>(f: (index: number) => T): Scale<T> {
  return STEPS.map(f) as unknown as Scale<T>;
}

/**
 * Twelve hex steps: the ramp's fixed lightness, its shape scaled by the chroma dial, at one hue.
 *
 * This is the whole generator. Every step shares the hue, so a generated scheme has one hue where a
 * hand-authored one drifts by a few degrees per step; and every step's lightness is the ramp's, so
 * no dial setting can move a contrast pair across its floor. A chroma of `0` yields a purely
 * achromatic scale — which is `theme-neutral.css` — so the shipped default is a point in this space
 * rather than a special case outside it.
 *
 * The shipped tint ladder in dial units (chroma × 1000) is roughly neutral 0, stone 12, gray 20,
 * slate 45.
 * @public
 */
export function buildScale(ramp: Ramp, dials: Dials): Scale<string> {
  return twelve((i) => oklchToHex(ramp.lightness[i] ?? 0, (ramp.chroma[i] ?? 0) * dials.chroma, dials.hue));
}

/** One candidate overlay for a step, and how far it lands from the solid it must reproduce. */
interface Overlay {
  hex: string;
  error: number;
}

/**
 * The faintest overlay of a given base that composites to `target` over `page`, and its error.
 *
 * `α·V + (1−α)·P = T` solved twice over: first for the alpha, as `max over channels of
 * (T−P)/(B−P)`, then for the overlay colour `V` by rearrangement. Taking the maximum over channels
 * is what keeps every channel's `V` inside 0–1; taking the *minimum* workable alpha is what makes
 * the overlay tint least when it lands on a surface that is not step 1, which is the entire reason
 * to want an alpha scale at all.
 *
 * The alpha is quantised to the byte the hex will carry **before** `V` is solved, so the emitted
 * colour is the one that composites correctly at the alpha actually written rather than at the
 * unrepresentable one it was solved for.
 */
function solveOverlay(target: readonly [number, number, number], page: readonly [number, number, number], base: 0 | 1): Overlay {
  let alpha = 0;
  for (let ch = 0; ch < 3; ch++) {
    const p = page[ch] ?? 0;
    const denominator = base - p;
    if (denominator !== 0) alpha = Math.max(alpha, ((target[ch] ?? 0) - p) / denominator);
  }

  const alphaByte = Math.round(clip01(alpha) * 255);
  if (alphaByte === 0) {
    const error = Math.max(...target.map((t, ch) => Math.abs(t - (page[ch] ?? 0))));
    return { hex: "#00000000", error };
  }

  const quantised = alphaByte / 255;
  let hex = "#";
  let error = 0;
  for (let ch = 0; ch < 3; ch++) {
    const p = page[ch] ?? 0;
    const t = target[ch] ?? 0;
    const v = clip01((t - p * (1 - quantised)) / quantised);
    hex += byte(v);
    error = Math.max(error, Math.abs(quantised * (Math.round(v * 255) / 255) + (1 - quantised) * p - t));
  }
  return { hex: `${hex}${alphaByte.toString(16).padStart(2, "0")}`, error };
}

/**
 * The alpha half of a scale: twelve `#rrggbbaa` overlays that composite to the solid steps.
 *
 * Each step is solved rather than guessed — see {@link solveOverlay} for the arithmetic. What is
 * decided here is which **base** to solve against, and it is decided per step by which one actually
 * works, not per mode by convention. `mode` names the base the mode conventionally uses — black in
 * light, white in dark, since a tint is applied by darkening in one and lightening in the other —
 * and is the tie-break; a step whose target lies the other side of the page background falls back
 * to the opposite base rather than emitting an overlay that cannot reach it.
 *
 * **That fallback is load-bearing, not defensive.** Forge swaps light steps 1 and 2 so `--card`
 * reads as raised, which leaves step 2 *lighter* than step 1 — and step 1 is the page. No quantity
 * of black reproduces a colour lighter than what it is painted on, so a mode-fixed base would emit
 * `#00000000` for `--gray-a2` and silently lose the step. The swap is deliberate and documented in
 * `theme-neutral.css`; this is the arithmetic that follows from it.
 *
 * The cost of that follows too, and is worth stating rather than discovering: light `a2` comes out
 * around 50% white, because it has to cover a three-byte gap from a base 24 bytes away. Radix's own
 * light `a2` is a 6/255 *black* — the same step, computed on a scale where 2 is darker than 1. So
 * forge's `a2` is a strong overlay where Radix's is a faint one, and on any surface other than the
 * page it will lighten hard. That is the swap's price, paid at exactly one step of twenty-four.
 *
 * **These will not equal Radix's**, and `theme-neutral.css` says why: Radix hand-tunes each alpha
 * step so it "appears visually the same when placed over the page background", across sRGB and P3,
 * and no formula reproduces that. What this does guarantee is reconstruction of its own solid step
 * over step 1 to within a byte — which for a generated scheme is the property that can actually be
 * checked, and `color.test.ts` checks it.
 * @public
 */
export function buildAlphaScale(scale: Scale<string>, mode: Mode): Scale<string> {
  const page = channels(scale[0]);
  const conventional = mode === "light" ? 0 : 1;
  const opposite = mode === "light" ? 1 : 0;

  return twelve((i) => {
    const target = channels(scale[i] ?? scale[0]);
    const first = solveOverlay(target, page, conventional);
    if (first.error <= 1 / 255) return first.hex;
    const second = solveOverlay(target, page, opposite);
    return second.error < first.error ? second.hex : first.hex;
  });
}
