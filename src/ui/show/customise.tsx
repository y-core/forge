/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

// No generated colour reaches the browser as markup: forge ships `style-src 'self'` with no style
// nonce, and `render-to-string.ts` drops inline-style attributes — the swatches are painted through
// CSSOM by the eager `customise` scope instead.

import type { AppContext } from "../../context/types";
import type { FC } from "../../jsx/types";
import type { Mode, Scale } from "../contracts/theme/color";
import { CRITERION, type ScalePair, scalePairs } from "../contracts/theme/contrast-pairs";
import {
  buildTheme,
  COPY_ACTION,
  COPY_LABEL_ATTR,
  COPY_SCOPE,
  COPY_STATUS_ATTR,
  COPY_TARGET_ATTR,
  COPY_TARGETS,
  type CopyTarget,
  CUSTOMISE_SCOPE,
  DIALS,
  type Dial,
  type DialValues,
  dialQuery,
  type GeneratedTheme,
  HEX_ATTR,
  type LiveRatio,
  leverRows,
  liveRatios,
  matchPreset,
  PRESET_ACTION,
  PRESET_CUSTOM,
  PRESET_PARAM,
  ratioKey,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  SCHEME_PRESETS,
  STEP_SEGMENTS,
  schemeCss,
} from "../contracts/theme/theme-contract";
import { Slider } from "../controls/slider";
import { Button } from "../core/button";
import { fieldId } from "../core/field";
import type { ForgeIcon } from "../core/icon";
import { Label } from "../core/label";
import { Select } from "../core/select";
import { Resumable } from "../server/resumable";
import { CompositionsSection } from "./compositions";

/** The glyphs the demonstration band draws — the customiser itself needs none. @public */
export type CustomiseIcon = ForgeIcon<"spinner" | "chevron-down">;

/** Data returned by {@link loadCustomise}. @public */
export interface CustomiseData {
  /** Every dial's value, already clamped and snapped. Keyed by `Dial.field`. */
  dials: DialValues;
  path: string;
}

/** Reads one dial off the query string, clamped to its range and rounded to its step. */
function readDial(params: URLSearchParams, dial: Dial): number {
  const raw = params.get(dial.param);
  if (raw === null) return dial.fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return dial.fallback;
  const clamped = Math.min(Math.max(parsed, dial.min), dial.max);
  return Math.round(clamped / dial.step) * dial.step;
}

/** Resolves `?p=slate` into the two gray dials that reproduce it; an explicit dial wins over the alias. */
function applyPreset(params: URLSearchParams, dials: DialValues): void {
  const preset = SCHEME_PRESETS.find((candidate) => candidate.id === params.get(PRESET_PARAM));
  if (preset === undefined) return;
  for (const field of ["grayHue", "grayChroma"] as const) {
    const dial = DIALS.find((candidate) => candidate.field === field);
    if (dial !== undefined && !params.has(dial.param)) dials[field] = preset[field];
  }
}

/** Loader for the customiser page — the URL is the whole of its state. @public */
export function loadCustomise<Bindings = Record<string, unknown>>(c: AppContext<Bindings>, opts: { path?: string } = {}): CustomiseData {
  const dials: DialValues = {};
  for (const dial of DIALS) dials[dial.field] = readDial(c.url.searchParams, dial);
  applyPreset(c.url.searchParams, dials);
  return { dials, path: opts.path ?? "/showcase/ui/theme" };
}

/** The row template: family, then a (label, slider) pair per dial. */
const LEVER_GRID = "grid items-center gap-x-3 gap-y-2 md:grid-cols-[4.5rem_7rem_minmax(0,1fr)_7rem_minmax(0,1fr)]";

/** One dial's two cells: its label-with-value, and its slider. */
const LeverCells: FC<{ dial: Dial; value: number; labelSpan?: string; controlSpan?: string }> = ({ dial, value, labelSpan, controlSpan }) => (
  <>
    <div class={`flex items-baseline gap-2${labelSpan === undefined ? "" : ` ${labelSpan}`}`}>
      <Label for={fieldId(dial.field)}>
        {dial.group === null ? null : <span class='sr-only'>{`${dial.group} `}</span>}
        {dial.short}
      </Label>
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

// The `custom` option is always rendered rather than only when the dials sit between presets: it is
// what the client selects the moment a slider moves off one, and an option that is not there cannot
// be selected. `disabled` keeps it out of the reader's own choices — it names a state, not a destination.
/** The four shipped schemes, as a starting point to pick from — applied the moment one is chosen. */
const PresetPicker: FC<{ dials: DialValues; icon: CustomiseIcon }> = ({ dials, icon }) => {
  const current = matchPreset(dials);
  return (
    <div class='w-64 space-y-1.5'>
      <Label for={fieldId(PRESET_PARAM)}>Theme preset</Label>
      {/* Deliberately not a bound control. Which preset the dials name is *derived*, so it is painted
          from `matchPreset` and never stored — a signal behind it would have to be written from the
          repaint effect, which the reactive rule forbids. As an input it commands, via the action. */}
      <Select data-on-change={PRESET_ACTION} data-preset-picker='' field={{ name: PRESET_PARAM }} icon={icon}>
        <Select.Option value={PRESET_CUSTOM} disabled {...(current === undefined ? { selected: true } : {})}>
          custom
        </Select.Option>
        {SCHEME_PRESETS.map((preset) => (
          <Select.Option value={preset.id} {...(preset === current ? { selected: true } : {})}>
            {`${preset.id} (${preset.character})`}
          </Select.Option>
        ))}
      </Select>
    </div>
  );
};

const LeversSection: FC<{ dials: DialValues; icon: CustomiseIcon }> = ({ dials, icon }) => (
  <section id='levers' class='scroll-mt-24 space-y-4'>
    <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>Levers</h2>
    <p class='text-sm text-muted-foreground'>Hue and chroma over a fixed lightness ramp ensuring contrast ratios remain WCAG compliant.</p>
    <Resumable name={CUSTOMISE_SCOPE} state={dials} class='space-y-4'>
      <PresetPicker dials={dials} icon={icon} />
      <p class='text-sm text-muted-foreground'>
        Each preset sets the gray dials to the values that reproduce a scheme forge ships, and the page repaints as you pick one.{" "}
        <code class='font-mono'>neutral</code> is exact; the other three land within 1% per channel, because their hue drifts slightly from step to
        step and the dials apply one hue to all twelve.
      </p>
      <div class='space-y-3'>
        {leverRows().map((row) => (
          <LeverRow dials={row} values={dials} />
        ))}
      </div>
    </Resumable>
  </section>
);

/** The step numbers, printed once for the whole table rather than once per swatch. */
const STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** The box's outline, assembled from the cells on its edge. */
// A `<tbody>` cannot carry the frame: `border-radius` does not apply to table elements in the
// collapsing model, and a row group may not carry a border at all in the separated one.
function boxEdge(step: number, edge: "top" | "bottom"): string {
  const parts = [edge === "top" ? "border-t" : "border-b"];
  if (step === 0) parts.push("border-s", edge === "top" ? "rounded-ss-md" : "rounded-es-md");
  if (step === STEPS.length - 1) parts.push("border-e", edge === "top" ? "rounded-se-md" : "rounded-ee-md");
  return `${parts.join(" ")} border-border`;
}

const ScaleRow: FC<{ id: string; scale: Scale<string> }> = ({ id, scale }) => (
  <tbody {...{ [SCALE_ROW_ATTR]: id }}>
    <tr>
      {STEPS.map((step) => (
        <td class={`px-1 pt-2 ${boxEdge(step, "top")}`}>
          <div data-swatch={step} class='h-10 w-full rounded-sm border' />
        </td>
      ))}
    </tr>
    <tr>
      {STEPS.map((step) => (
        <td
          {...{ [HEX_ATTR]: step }}
          class={`px-1 pb-2 pt-1 text-center text-xs leading-none tabular-nums text-muted-foreground ${boxEdge(step, "bottom")}`}>
          {scale[step]}
        </td>
      ))}
    </tr>
  </tbody>
);

/** Each band with the 1-based step range it covers. */
const BANDS = STEP_SEGMENTS.map((segment, i) => {
  const from = STEP_SEGMENTS.slice(0, i).reduce((steps, earlier) => steps + earlier.span, 1);
  return { ...segment, from, to: from + segment.span - 1 };
});

// Module-local, and named apart from `sections.tsx`'s `@public` `PreviewSection`: two exports of one
// name in one namespace is the collision, and only one of them is public.
const ScalePreviewSection: FC<{ theme: GeneratedTheme }> = ({ theme }) => (
  <section id='preview' class='scroll-mt-24 space-y-4'>
    <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>Scales</h2>
    <p class='text-sm text-muted-foreground'>
      Both generated families, each drawn on the surface it belongs to. Every semantic token resolves through one of these forty-eight steps.
    </p>
    <div class='overflow-x-auto'>
      <table class='w-full table-fixed border-separate border-spacing-0 min-w-[44rem]'>
        <caption class='sr-only'>
          {`Every generated step, grouped as ${BANDS.map((band) => `${band.label.toLowerCase()} at steps ${band.from} to ${band.to}`).join(", ")}. Rows: ${SCALE_ROWS.map((row) => row.label.toLowerCase()).join(", then ")}`}
        </caption>
        <thead>
          <tr>
            {BANDS.map((band, i) => (
              <th
                scope='colgroup'
                colspan={band.span}
                class={`pb-1 text-center text-xs font-medium text-muted-foreground ${i === 0 ? "" : "border-s border-border"}`}>
                {band.label}
              </th>
            ))}
          </tr>
          <tr>
            {STEPS.map((step) => (
              <th scope='col' class='pb-1 text-center text-xs font-medium tabular-nums text-muted-foreground'>
                {step + 1}
              </th>
            ))}
          </tr>
        </thead>
        {/* The label rides its own `<tbody>`, a sibling of the row's — so every
            `[data-scale-row] tr:first-child` selector still names a swatch row — and `table-fixed`
            keeps its `colspan` from touching the column widths the swatches align to. */}
        {SCALE_ROWS.map((row, i) => (
          <>
            <tbody>
              <tr>
                <td colspan={STEPS.length} class={`pb-1 text-xs font-medium text-muted-foreground ${i === 0 ? "" : "pt-5"}`}>
                  {row.label}
                </td>
              </tr>
            </tbody>
            <ScaleRow id={row.id} scale={theme[row.family][row.mode].solid} />
          </>
        ))}
      </table>
    </div>
  </section>
);

/** One pair's row: its token and criterion, then a ratio cell per mode. */
const WcagRow: FC<{ pair: ScalePair; ratios: ReadonlyMap<string, LiveRatio> }> = ({ pair, ratios }) => {
  const cell = (mode: Mode) => {
    const key = ratioKey(pair.token, pair.background.token, mode);
    return (
      <td data-ratio={key} class='py-2 pe-4 tabular-nums text-foreground'>
        {ratios.get(key)?.text}
      </td>
    );
  };
  return (
    <tr data-pair={pair.token} class='border-b border-border last:border-0'>
      <td class='py-2 pe-4 font-mono text-foreground'>
        {pair.token} <span class='text-muted-foreground'>on {pair.background.token}</span>
      </td>
      <td class='py-2 pe-4 text-muted-foreground'>{CRITERION[pair.criterion].name}</td>
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
        The seven audited pairs the levers can actually move — both sides generated from the scales above, so each recomputes as you drag. The other
        sixteen have a side on a fixed palette stop no dial reaches; they are checked against the shipped scheme by forge's own audit rather than
        reported here.
      </p>
      <p class='text-sm text-muted-foreground'>
        No gray setting fails: the ramp fixes lightness, and the tightest point the gray levers reach is <code class='font-mono'>--input</code> at
        about 3.19:1 against a 3:1 floor. <strong class='font-medium text-foreground'>No accent setting fails either, by 0.09.</strong>{" "}
        <code class='font-mono'>--accent-contrast</code> is <code class='font-mono'>--gray-1</code> in light but the darker{" "}
        <code class='font-mono'>--gray-12</code> in dark, so dark carries the smaller headroom at every position. A band of high-chroma greens near
        hue 145 once put it under the 4.5 floor; the dark ramp's step 9 is lowered to buy the margin back, and sweeping all four colour levers
        together the tightest point measured is 4.59:1 in dark against 4.84:1 in light. That is a real margin rather than a comfortable one — read
        the number here rather than trusting the dials.
      </p>
      <div class='overflow-x-auto'>
        <table class='w-full min-w-[36rem] text-start text-xs'>
          <thead>
            <tr class='border-b border-border text-muted-foreground'>
              <th class='py-2 pe-4 font-medium'>Token</th>
              <th class='py-2 pe-4 font-medium'>Criterion</th>
              <th class='py-2 pe-4 font-medium'>Light</th>
              <th class='py-2 font-medium'>Dark</th>
            </tr>
          </thead>
          <tbody>
            {scalePairs().map((pair) => (
              <WcagRow pair={pair} ratios={ratios} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// No `aria-label`: the visible label swaps to "Copied", and a static name still reading "Copy CSS"
// would breach WCAG 2.5.3. The announcement goes through the status span, which is not the name.
/** One target's control: a `size='sm'` Button — the floor of the scale — and the span it announces through. */
const CopyButton: FC<{ target: CopyTarget }> = ({ target }) => (
  <span class='inline-flex items-center gap-2'>
    <Button variant='secondary' size='sm' data-on-click={COPY_ACTION} {...{ [COPY_TARGET_ATTR]: target.id }}>
      <span {...{ [COPY_LABEL_ATTR]: "" }}>{target.label}</span>
    </Button>
    <span role='status' class='sr-only' {...{ [COPY_STATUS_ATTR]: target.id }} />
  </span>
);

const copyTarget = (id: string): CopyTarget => {
  const target = COPY_TARGETS.find((candidate) => candidate.id === id);
  if (target === undefined) throw new Error(`no copy target named ${id}`);
  return target;
};

const OutputSection: FC<{ theme: GeneratedTheme; dials: DialValues; path: string }> = ({ theme, dials, path }) => {
  const query = dialQuery(dials);
  return (
    <section id='output' class='scroll-mt-24 space-y-4'>
      <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>Take it away</h2>
      <p class='text-sm text-muted-foreground'>
        A scheme file is exactly twelve steps per family. This is the scheme. Save it beside <code>theme-neutral.css</code> and import it after.
      </p>
      <Resumable name={COPY_SCOPE} class='space-y-4'>
        <div class='flex flex-wrap items-center gap-3'>
          <p class='text-sm text-muted-foreground'>
            Shareable at <code data-share-url>{`${path}?${query}`}</code> — the URL is this page's only state.
          </p>
          <CopyButton target={copyTarget("url")} />
        </div>
        <div class='flex items-center gap-3'>
          <CopyButton target={copyTarget("css")} />
        </div>
        <pre data-scheme-output class='max-h-96 overflow-auto rounded-lg border border-border bg-muted p-4 text-xs text-foreground'>
          <code>{schemeCss(theme, dials)}</code>
        </pre>
      </Resumable>
    </section>
  );
};

/** The customiser page. @public */
export const CustomiseContent: FC<{ data: CustomiseData; icon: CustomiseIcon }> = ({ data, icon }) => {
  const theme = buildTheme(data.dials);
  return (
    <main id='main-content' class='flex-1 min-w-0 mx-auto max-w-4xl px-6 py-10 lg:px-10 space-y-6'>
      <div>
        <h1 class='text-3xl font-bold text-foreground text-balance'>Theme customiser</h1>
      </div>

      <LeversSection dials={data.dials} icon={icon} />
      <ScalePreviewSection theme={theme} />
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
