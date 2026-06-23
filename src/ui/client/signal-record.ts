import { createSignal, type Signal } from "./signal";

/** Maps a plain state object to one signal per key. @public */
export type SignalRecord<T> = { [K in keyof T]: Signal<T[K]> };

/** Builds one independent signal per key of `initial`, preserving each value's type. @public */
export function signalRecord<T extends Record<string, unknown>>(initial: T): SignalRecord<T> {
  const out = {} as SignalRecord<T>;
  for (const key of Object.keys(initial) as Array<keyof T>) {
    out[key] = createSignal(initial[key]);
  }
  return out;
}

/** Typed per-key writer — threads `T[K]` so a union key type-checks against its own value type. @public */
export function writeSignal<T, K extends keyof T>(rec: SignalRecord<T>, key: K, value: T[K]): void {
  rec[key].value = value;
}
