import type { AuthLimit } from "./types";

function bound(value: number, unit: string | undefined): string {
  return unit === undefined ? `${value}` : `${value}-${unit}`;
}

/** Resolves a configured whole-number knob against its default, refused outside the range its standard allows. @internal */
export function authLimit(operation: string, knob: string, requested: number | undefined, limit: AuthLimit): number {
  const value = requested ?? limit.fallback;
  if (!Number.isInteger(value)) {
    throw new Error(`${operation}: ${knob} is ${value}, which is not a whole number.`);
  }
  if (value < limit.min) {
    throw new Error(`${operation}: ${knob} is ${value}, below the ${bound(limit.min, limit.unit)} floor — ${limit.floor}.`);
  }
  if (limit.max !== undefined && value > limit.max) {
    throw new Error(`${operation}: ${knob} is ${value}, above the ${bound(limit.max, limit.unit)} ceiling — ${limit.ceiling}.`);
  }
  return value;
}
