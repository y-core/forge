/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

// No generated colour reaches the browser as markup: forge ships `style-src 'self'` with no style
// nonce, and `render-to-string.ts` drops inline-style attributes — the swatches are painted through
// CSSOM by the eager `customise` scope instead.

import type { AppContext } from "../../context/types";
import type { FC } from "../../jsx/types";
import type { Mode, Scale } from "../contracts/color";
import { CRITERION, scalePairs } from "../contracts/contrast-pairs";
import {
  buildTheme,
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
  PRESET_PARAM,
  ratioKey,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  SCHEME_PRESETS,
  STEP_SEGMENTS,
  schemeCss,
} from "../contracts/theme-contract";
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

/** The four shipped schemes, as a starting point to pick from. */
const PresetPicker: FC<{ dials: DialValues; path: string; icon: CustomiseIcon }> = ({ dials, path, icon }) => {
  const current = SCHEME_PRESETS.find((preset) => dials.grayHue === preset.grayHue && dials.grayChroma === preset.grayChroma);
  return (
    <form method='get' action={path} class='flex flex-wrap items-end gap-3'>
      {DIALS.filter((dial) => dial.field !== "grayHue" && dial.field !== "grayChroma").map((dial) => (
        /* design-allow: forge-ui-catalog-wrong-raw-input — a hidden field is form payload, not a control */
        <input type='hidden' name={dial.param} value={String(dials[dial.field] ?? dial.fallback)} />
      ))}
      <div class='w-64 space-y-1.5'>
        <Label for={fieldId(PRESET_PARAM)}>Theme preset</Label>
        <Select field={{ name: PRESET_PARAM }} icon={icon}>
          {current === undefined ? (
            <Select.Option value='' disabled selected>
              custom
            </Select.Option>
          ) : null}
          {SCHEME_PRESETS.map((preset) => (
            <Select.Option value={preset.id} {...(preset === current ? { selected: true } : {})}>
              {`${preset.id} (${preset.character})`}
            </Select.Option>
          ))}
        </Select>
      </div>
      <Button type='submit' variant='secondary'>
        Apply
      </Button>
    </form>
  );
};

const LeversSection: FC<{ dials: DialValues; path: string; icon: CustomiseIcon }> = ({ dials, path, icon }) => (
  <section id='levers' class='scroll-mt-24 space-y-4'>
    <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>Levers</h2>
    <p class='text-sm text-muted-foreground'>Hue and chroma over a fixed lightness ramp ensuring contrast ratios remain WCAG compliant.</p>
    <PresetPicker dials={dials} path={path} icon={icon} />
    <p class='text-sm text-muted-foreground'>
      Each preset sets the gray dials to the values that reproduce a scheme forge ships. <code class='font-mono'>neutral</code> is exact; the other
      three land within 1% per channel, because their hue drifts slightly from step to step and the dials apply one hue to all twelve.
    </p>
    <Resumable name={CUSTOMISE_SCOPE} state={dials} class='space-y-3'>
      {leverRows().map((row) => (
        <LeverRow dials={row} values={dials} />
      ))}
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
  if (step === 0) parts.push("border-l", edge === "top" ? "rounded-tl-md" : "rounded-bl-md");
  if (step === STEPS.length - 1) parts.push("border-r", edge === "top" ? "rounded-tr-md" : "rounded-br-md");
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

const PreviewSection: FC<{ theme: GeneratedTheme }> = ({ theme }) => (
  <section id='preview' class='scroll-mt-24 space-y-4'>
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
                class={`pb-1 text-center text-xs font-medium text-muted-foreground ${i === 0 ? "" : "border-l border-border"}`}>
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
        {SCALE_ROWS.map((row, i) => (
          <>
            {i === 0 ? null : (
              <tbody aria-hidden='true'>
                <tr>
                  <td colspan={STEPS.length} class='h-4' />
                </tr>
              </tbody>
            )}
            <ScaleRow id={row.id} scale={theme.gray[row.mode].solid} />
          </>
        ))}
      </table>
    </div>
  </section>
);

/** One pair's row: its token and criterion, then a ratio cell per mode. */
const WcagRow: FC<{ pair: ReturnType<typeof scalePairs>[number]; ratios: ReadonlyMap<string, LiveRatio> }> = ({ pair, ratios }) => {
  const cell = (mode: Mode) => {
    const key = ratioKey(pair.token, pair.background.token, mode);
    return (
      <td data-ratio={key} class='py-2 pr-4 tabular-nums text-foreground'>
        {ratios.get(key)?.text}
      </td>
    );
  };
  return (
    <tr data-pair={pair.token} class='border-b border-border last:border-0'>
      <td class='py-2 pr-4 font-mono text-foreground'>
        {pair.token} <span class='text-muted-foreground'>on {pair.background.token}</span>
      </td>
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
        The six audited pairs the levers can actually move — both sides generated from the scale above, so each recomputes as you drag. The other
        seventeen have a side on a fixed palette stop no dial reaches; they are checked against the shipped scheme by forge's own audit rather than
        reported here. No setting fails: the ramp fixes lightness, and the tightest point in the whole lever range is{" "}
        <code class='font-mono'>--input</code> at about 3.19:1 against a 3:1 floor.
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
            {scalePairs().map((pair) => (
              <WcagRow pair={pair} ratios={ratios} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const OutputSection: FC<{ theme: GeneratedTheme; dials: DialValues; path: string }> = ({ theme, dials, path }) => {
  const query = dialQuery(dials);
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

/** The customiser page. @public */
export const CustomiseContent: FC<{ data: CustomiseData; icon: CustomiseIcon }> = ({ data, icon }) => {
  const theme = buildTheme(data.dials);
  return (
    <main id='main-content' class='flex-1 min-w-0 mx-auto max-w-4xl px-6 py-10 lg:px-10 space-y-6'>
      <div>
        <h1 class='text-3xl font-bold text-foreground'>Theme customiser</h1>
      </div>

      <LeversSection dials={data.dials} path={data.path} icon={icon} />
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
