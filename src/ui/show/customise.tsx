/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

/**
 * The theme customiser — a route that generates forge schemes and reports what they measure.
 *
 * ## Why this can exist, and why the Radix page it is modelled on cannot make the same promise
 *
 * Every scheme forge ships sits on **one lightness ramp** and differs only in chroma and hue. That
 * is not a coincidence to be preserved carefully; it is the property that makes contrast *decidable
 * before the user touches anything*. Lightness is fixed, so the two free parameters cannot push an
 * audited pair under its floor — swept and asserted in `contracts/color.test.ts` rather than argued
 * here.
 *
 * <https://www.radix-ui.com/colors/custom> offers three free colour pickers over a transposable
 * ramp, which is more expressive and correspondingly cannot promise conformance: a user may pick a
 * background that breaks the floors, and the page cannot say so in advance. Forge trades that
 * expressiveness for a guarantee, and the live WCAG readouts below are what the guarantee buys.
 *
 * ## What is server-rendered, and what is not
 *
 * The levers, the labels, every hex value as **text**, and the whole WCAG table are rendered on the
 * Worker — so the page is fully readable, shareable and correct with no JavaScript at all. The URL
 * is the only state; there is no `localStorage` and no FOUC script.
 *
 * What is *not* server-rendered is colour. Forge ships `style-src 'self'` with no `'unsafe-inline'`
 * and no style nonce (`src/security/headers.ts`), and `render-to-string.ts` drops every inline-style
 * attribute for exactly that reason — so neither an inline `<style>` block nor an inline-style
 * attribute can carry a generated colour to the browser. The swatches are therefore painted by the eager
 * `customise` scope through CSSOM, which CSP does not police, and this one route accepts a single
 * frame of the default scheme before it resumes. That is a deliberate trade recorded here rather
 * than a gap: the alternative was relaxing the CSP library-wide for one demo page.
 */

import type { AppContext } from "../../context/types";
import type { FC } from "../../jsx/types";
import type { Mode, Scale } from "../contracts/color";
import { CONTRAST_PAIRS, CRITERION } from "../contracts/contrast-pairs";
import {
  buildTheme,
  CUSTOMISE_SCOPE,
  DIALS,
  type Dial,
  type DialValues,
  type GeneratedTheme,
  HEX_ATTR,
  type LiveRatio,
  leverRows,
  liveRatios,
  ratioKey,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  schemeCss,
} from "../contracts/theme-contract";
import { Slider } from "../controls/slider";
import { fieldId } from "../core/field";
import type { ForgeIcon } from "../core/icon";
import { Label } from "../core/label";
import { Resumable } from "../server/resumable";
import { CompositionsSection } from "./compositions";

/** The glyphs the demonstration band draws — the customiser itself needs none. @public */
export type CustomiseIcon = ForgeIcon<"spinner" | "chevron-down">;

// ─── Loader ──────────────────────────────────────────────────────────────────

/** Data returned by {@link loadCustomise}. @public */
export interface CustomiseData {
  /** Every dial's value, already clamped and snapped. Keyed by `Dial.field`. */
  dials: DialValues;
  /** The page's own path, so the "share this scheme" link can be built without guessing it. */
  path: string;
}

/**
 * Read one dial off the query string.
 *
 * Clamped to the dial's own range and rounded to its step, so a hand-edited URL cannot render a
 * scheme the sliders could not have produced — which matters because the URL *is* the state, and a
 * shared link is the one input this page takes from a stranger. A missing or unparseable parameter
 * falls back rather than failing: a customiser that 400s on a truncated URL would be worse than one
 * that shows the default.
 */
function readDial(params: URLSearchParams, dial: Dial): number {
  const raw = params.get(dial.param);
  if (raw === null) return dial.fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return dial.fallback;
  const clamped = Math.min(Math.max(parsed, dial.min), dial.max);
  return Math.round(clamped / dial.step) * dial.step;
}

/** Loader for the customiser page — the URL is the whole of its state. @public */
export function loadCustomise<Bindings = Record<string, unknown>>(c: AppContext<Bindings>, opts: { path?: string } = {}): CustomiseData {
  const dials: DialValues = {};
  for (const dial of DIALS) dials[dial.field] = readDial(c.url.searchParams, dial);
  return { dials, path: opts.path ?? "/showcase/ui/theme" };
}

// ─── Levers ──────────────────────────────────────────────────────────────────

/**
 * The row template: family, then a (label, slider) pair per dial.
 *
 * Bracketed track lists rather than named widths, and that is legal precisely where it looks least
 * so: `grid-cols` carries no value the spacing scale could be compared against, so it is not one of
 * the heads `forge-ui-spacing-scale-only` checks — `core/card.tsx`'s header does the same. Every
 * gap below *is* a scale step.
 *
 * One column below `md`, because two sliders side by side on a phone would put each under the hit
 * target. The control does not shrink to fit the layout; the layout gives way.
 */
const LEVER_GRID = "grid items-center gap-x-3 gap-y-2 md:grid-cols-[4.5rem_7rem_minmax(0,1fr)_7rem_minmax(0,1fr)]";

/**
 * One dial's two cells: its label-with-value, and its slider.
 *
 * Emitted as a `Fragment` rather than wrapped, because a wrapper would be a single grid item holding
 * both and the second dial's slider would stop aligning with the first's.
 *
 * **No `id` or `for` is written here.** `Slider` takes a `FieldDescriptor` and routes it through
 * `fieldControlProps`, which derives `id={fieldId(name)}`; the `Label` derives the identical IDREF
 * from the same helper. That is `forge-ui-form-id-helpers`: a `for=` that agrees with an `id=` by
 * coincidence rather than derivation fails silently — nothing errors, and clicking the label simply
 * stops focusing the control.
 */
const LeverCells: FC<{ dial: Dial; value: number; labelSpan?: string; controlSpan?: string }> = ({ dial, value, labelSpan, controlSpan }) => (
  <>
    <div class={`flex items-baseline gap-2${labelSpan === undefined ? "" : ` ${labelSpan}`}`}>
      {/* The accessible name is the whole of `dial.label` — "Accent hue" — while only "hue" is
          drawn, because the family is printed once for the row. The prefix is hidden inside the
          label the control already points at rather than supplied as `aria-label`, which would
          replace this element's text outright and leave two names to keep in step. */}
      <Label for={fieldId(dial.field)}>
        {dial.group === null ? null : <span class='sr-only'>{`${dial.group} `}</span>}
        {dial.short}
      </Label>
      {/* `data-readout` is what the client's effect writes into. It is server-rendered with the same
          number the slider carries, so the pair agrees before any script runs — `Slider` ships no
          client controller by decision, and nothing else reconciles a thumb with its readout.
          A sibling of the label rather than inside it: inside, the accessible name would change on
          every frame of a drag. */}
      <output data-readout={dial.field} class='text-xs tabular-nums text-muted-foreground'>
        {`${value}${dial.unit}`}
      </output>
    </div>
    <Slider
      bind={dial.field}
      field={{ name: dial.field }}
      min={dial.min}
      max={dial.max}
      step={dial.step}
      value={value}
      {...(controlSpan === undefined ? {} : { class: controlSpan })}
    />
  </>
);

const LeverRow: FC<{ dials: readonly Dial[]; values: DialValues }> = ({ dials, values }) => {
  const solo = dials.length === 1;
  return (
    <div class={LEVER_GRID}>
      {/* A solo dial has no family to print, so its label takes the family cell's place as well as
          its own and its slider runs the remaining three tracks. Spanning the *same* template rather
          than declaring a second one is what keeps the lone slider starting at the same x as the
          first slider of every paired row — a separate two-track grid would have to restate the
          arithmetic, and would drift from it at the first edit. */}
      {solo ? null : <span class='text-sm font-medium text-muted-foreground'>{dials[0]?.group}</span>}
      {dials.map((dial) => (
        <LeverCells
          dial={dial}
          value={values[dial.field] ?? dial.fallback}
          {...(solo ? { labelSpan: "md:col-span-2", controlSpan: "md:col-span-3" } : {})}
        />
      ))}
    </div>
  );
};

const LeversSection: FC<{ dials: DialValues }> = ({ dials }) => (
  <section id='levers' class='scroll-mt-24 space-y-4'>
    <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>Levers</h2>
    <p class='text-sm text-muted-foreground'>Hue and chroma over a fixed lightness ramp ensuring contrast ratios remain WCAG compliant.</p>
    <Resumable name={CUSTOMISE_SCOPE} state={dials} class='space-y-3'>
      {leverRows().map((row) => (
        <LeverRow dials={row} values={dials} />
      ))}
    </Resumable>
  </section>
);

// ─── The 2×2 preview ─────────────────────────────────────────────────────────

/** The step numbers, printed once for the whole table rather than once per swatch. */
const STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * One generated scale, in a box painted with that scale's own page colour.
 *
 * **The container is the label.** A box showing the dark scale is dark, so which surface a scale
 * belongs to is shown rather than captioned — a caption reading "dark scale, dark surface" over a
 * visibly dark box is a sentence the reader has to go and check.
 *
 * **The box cannot ask for the mode with a `dark` class, and finding out why is worth recording.**
 * Forge's semantic tokens are declared once on `:root` — `--background: var(--gray-1)` — so
 * `--background` *computes there*, to a literal, and inherits as that literal. A descendant carrying
 * `.dark` re-declares `--gray-1` and changes nothing else: the token above it was resolved before
 * the descendant existed. `.dark` works on `<html>` because both declarations compute on the same
 * element, in order. So a nested dark surface is not something forge's token layer can express, and
 * an earlier version of this page carried a `dark` class here that quietly did nothing.
 *
 * What it does instead is the thing the rest of this page already does: the browser paints from the
 * generated scale. That is better than a token would have been, because the box then demonstrates
 * the scale **using the scale** — its page is step 1, its muted text is step 11, its chip edges are
 * step 6. Nothing here names a colour.
 *
 * A border on a row group is also why `border-collapse` is not optional: in the collapsing model a
 * `<tbody>` may carry one, and in the separated model it is ignored outright.
 */
/**
 * The box's outline, assembled from the cells on its edge.
 *
 * **A `<tbody>` cannot be the box, and that is a spec fact rather than a browser quirk.**
 * `border-radius` is defined not to apply to table elements in the *collapsing* border model, and in
 * the *separated* model a row group may not carry a border at all — so between the two there is no
 * arrangement where one element is both bordered and rounded. Verified in a browser before
 * restructuring, because it is exactly the kind of thing that looks like it should work.
 *
 * What does work is a cell: in the separated model a `<td>` takes both a border and a radius. So the
 * frame is drawn by the cells that sit on it — the top row carries the top edge and the upper two
 * corners, the bottom row the rest — and the twelve interior cells carry only the horizontal edges.
 */
function boxEdge(step: number, edge: "top" | "bottom"): string {
  const parts = [edge === "top" ? "border-t" : "border-b"];
  if (step === 0) parts.push("border-l", edge === "top" ? "rounded-tl-md" : "rounded-bl-md");
  if (step === STEPS.length - 1) parts.push("border-r", edge === "top" ? "rounded-tr-md" : "rounded-br-md");
  return `${parts.join(" ")} border-border`;
}

const ScaleRow: FC<{ id: string; scale: Scale<string> }> = ({ id, scale }) => (
  <tbody {...{ [SCALE_ROW_ATTR]: id }}>
    <tr>
      {STEPS.map((step) => (
        <td class={`px-1 pt-2 ${boxEdge(step, "top")}`}>
          {/* The swatch is a `div` inside the cell, not the cell itself: the padding is what keeps
              twelve chips apart, and painting the cell would give one continuous band. */}
          <div data-swatch={step} class='h-10 w-full rounded-sm border' />
        </td>
      ))}
    </tr>
    <tr>
      {STEPS.map((step) => (
        // The hex is the only thing carrying the scheme to a reader with no JavaScript, since the
        // swatch above it is painted through CSSOM. It is also a claim about that paint, which is
        // why the client rewrites both in one pass from one array.
        <td
          {...{ [HEX_ATTR]: step }}
          class={`px-1 pb-2 pt-1 text-center text-xs leading-none tabular-nums text-muted-foreground ${boxEdge(step, "bottom")}`}>
          {scale[step]}
        </td>
      ))}
    </tr>
  </tbody>
);

const PreviewSection: FC<{ theme: GeneratedTheme }> = ({ theme }) => (
  <section id='preview' class='scroll-mt-24 space-y-4'>
    <div class='overflow-x-auto'>
      <table class='w-full table-fixed border-separate border-spacing-0 min-w-[44rem]'>
        <caption class='sr-only'>{`Every generated step: ${SCALE_ROWS.map((row) => row.label.toLowerCase()).join(", then ")}`}</caption>
        <thead>
          <tr>
            {STEPS.map((step) => (
              <th scope='col' class='pb-1 text-center text-xs font-medium tabular-nums text-muted-foreground'>
                {step + 1}
              </th>
            ))}
          </tr>
        </thead>
        {SCALE_ROWS.map((row) => (
          <ScaleRow id={row.id} scale={theme.gray[row.mode].solid} />
        ))}
      </table>
    </div>
  </section>
);

// ─── The live WCAG table ─────────────────────────────────────────────────────

/**
 * One pair's row: its token and criterion, then a ratio cell per mode.
 *
 * A live pair's cells carry `data-ratio` and the text `liveRatios` formatted, so the Worker's first
 * paint and the browser's rewrite agree by construction — `client.ts` looks the cell up by the same
 * key. A fixed pair has no key to write, because neither side resolves to a colour this repository
 * can compute; its cells say so rather than printing a number that can never move.
 */
const WcagRow: FC<{ pair: (typeof CONTRAST_PAIRS)[number]; ratios: ReadonlyMap<string, LiveRatio> }> = ({ pair, ratios }) => {
  const live = pair.foreground.kind === "scale" && pair.background.kind === "scale";
  const cell = (mode: Mode) => {
    if (!live) return <td class='py-2 pr-4 tabular-nums text-muted-foreground'>not generated</td>;
    const key = ratioKey(pair.token, mode);
    return (
      <td data-ratio={key} class='py-2 pr-4 tabular-nums text-foreground'>
        {ratios.get(key)?.text}
      </td>
    );
  };
  return (
    <tr data-pair={pair.token} data-live={live ? "true" : "false"} class='border-b border-border last:border-0'>
      <td class='py-2 pr-4 font-mono text-foreground'>{pair.token}</td>
      <td class='py-2 pr-4 text-muted-foreground'>{CRITERION[pair.criterion].name}</td>
      {cell("light")}
      {cell("dark")}
    </tr>
  );
};

const WcagSection: FC<{ theme: GeneratedTheme }> = ({ theme }) => {
  const ratios = new Map(liveRatios(theme).map((entry) => [entry.key, entry]));
  return (
    <section id='wcag' class='scroll-mt-24 space-y-4'>
      <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>WCAG, live</h2>
      <p class='text-sm text-muted-foreground'>
        Every pair forge's audit binds. Four are generated from the scale above and recompute as the levers move; the rest sit on a fixed palette
        stop no dial can reach.
      </p>
      <div class='overflow-x-auto'>
        <table class='w-full min-w-[36rem] text-left text-xs'>
          <thead>
            <tr class='border-b border-border text-muted-foreground'>
              <th class='py-2 pr-4 font-medium'>Token</th>
              <th class='py-2 pr-4 font-medium'>Criterion</th>
              <th class='py-2 pr-4 font-medium'>Light</th>
              <th class='py-2 font-medium'>Dark</th>
            </tr>
          </thead>
          <tbody>
            {CONTRAST_PAIRS.map((pair) => (
              <WcagRow pair={pair} ratios={ratios} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ─── Output ──────────────────────────────────────────────────────────────────

const OutputSection: FC<{ theme: GeneratedTheme; dials: DialValues; path: string }> = ({ theme, dials, path }) => {
  const query = DIALS.map((dial) => `${dial.param}=${dials[dial.field] ?? dial.fallback}`).join("&");
  return (
    <section id='output' class='scroll-mt-24 space-y-4'>
      <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>Take it away</h2>
      <p class='text-sm text-muted-foreground'>
        A scheme file is exactly twelve steps and twelve alpha steps per mode.This is the scheme. Save it beside <code>theme-neutral.css</code> and
        import it after.
      </p>
      <p class='text-sm text-muted-foreground'>
        Shareable at <code data-share-url>{`${path}?${query}`}</code> — the URL is this page's only state.
      </p>
      <pre data-scheme-output class='max-h-96 overflow-auto rounded-lg border border-border bg-muted p-4 text-xs text-foreground'>
        <code>{schemeCss(theme, dials)}</code>
      </pre>
    </section>
  );
};

// ─── The page ────────────────────────────────────────────────────────────────

/**
 * The customiser page.
 *
 * `CompositionsSection` closes it, moved here from the showcase catalog. The catalog proves each
 * component exists; a generated scheme has to be judged against a real composed UI, and this is the
 * one page where that judgement is the point rather than a side effect. @public
 */
export const CustomiseContent: FC<{ data: CustomiseData; icon: CustomiseIcon }> = ({ data, icon }) => {
  const theme = buildTheme(data.dials);
  return (
    <main id='main-content' class='flex-1 min-w-0 mx-auto max-w-4xl px-6 py-10 lg:px-10 space-y-6'>
      <div>
        <h1 class='text-3xl font-bold text-foreground'>Theme customiser</h1>
      </div>

      <LeversSection dials={data.dials} />
      <PreviewSection theme={theme} />
      <WcagSection theme={theme} />

      <div class='space-y-4'>
        <p class='text-sm text-muted-foreground'>
          Swatches show a scale; they do not show whether it works. Below is forge's composition band — a collection in four states, a settings
          form, and the feedback surfaces — repainted by every lever above.
        </p>
        <CompositionsSection icon={icon} />
      </div>

      <OutputSection theme={theme} dials={data.dials} path={data.path} />
    </main>
  );
};
