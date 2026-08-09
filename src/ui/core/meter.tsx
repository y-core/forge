/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface MeterRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

interface MeterTrackProps extends Omit<JSX.IntrinsicElements["meter"], "children"> {
  value: number;
}

const MeterRoot: FC<MeterRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("meter", inherited)} class={cn("flex w-full max-w-sm flex-col gap-1", asClass(cls))} {...rest}>
    {children}
  </div>
);

/** `for` is required, not optional: an unassociated `<label>` is decoration, and the whole reason to
 * use a real label is that clicking it and reading it both reach the measurement. */
const MeterLabel: FC<JSX.IntrinsicElements["label"] & { for: string }> = ({
  for: target,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label data-slot={slotToken("meter-label", inherited)} for={target} class={cn("text-sm font-medium text-foreground", asClass(cls))} {...rest}>
    {children}
  </label>
);

const MeterValue: FC<JSX.IntrinsicElements["span"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("meter-value", inherited)} class={cn("text-sm tabular-nums text-muted-foreground", asClass(cls))} {...rest}>
    {children}
  </span>
);

/** The measurement itself. There is no `Indicator` part: `<meter>` draws its own bar, and adding one
 * would mean re-creating a rendering the platform already does — and doing it worse, because the
 * UA's bar reflects `low` / `high` / `optimum` without being told how. */
const MeterTrack: FC<MeterTrackProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <meter data-slot={slotToken("meter-track", inherited)} class={cn("h-2 w-full", asClass(cls))} {...rest} />
);

/**
 * A scalar measurement within a known range, on native `<meter>`.
 *
 * **Not `core/progress.tsx`, and the difference is not cosmetic.** `<progress>` reports how far
 * along a *task* is; `<meter>` reports where a *quantity* sits in its range — disk usage, a score, a
 * temperature. A screen reader announces them differently, and `<meter>` alone understands `low`,
 * `high` and `optimum`, which is what makes a value render as "good" or "poor" without a stylesheet
 * being told which is which.
 *
 * ```tsx
 * <Meter>
 *   <Meter.Label for='disk'>Disk usage</Meter.Label>
 *   <Meter.Track id='disk' value={0.72} low={0.3} high={0.8} optimum={0.2} />
 *   <Meter.Value>72%</Meter.Value>
 * </Meter>
 * ```
 * @public
 */
export const Meter = Object.assign(MeterRoot, { Label: MeterLabel, Value: MeterValue, Track: MeterTrack });
