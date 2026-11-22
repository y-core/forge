import type { ContributionSlots } from "./types";

function isObject(item: unknown): item is object {
  return (typeof item === "object" && item !== null) || typeof item === "function";
}

/** Concatenates each slice's slot lists, in array order, into frozen slots; throws when one item object fills a slot twice. @public */
export function createContributionSlots<Shape extends object>(
  contributions: readonly Partial<{ [K in keyof Shape]: readonly Shape[K][] }>[],
): ContributionSlots<Shape> {
  const slots = new Map<string, unknown[]>();
  for (const contribution of contributions) {
    for (const [slot, items] of Object.entries<readonly unknown[] | undefined>(contribution)) {
      const held = slots.get(slot) ?? [];
      for (const item of items ?? []) {
        if (isObject(item) && held.includes(item)) throw new Error(`createContributionSlots: the slot "${slot}" is given one item twice.`);
        held.push(item);
      }
      slots.set(slot, held);
    }
  }
  const frozen = new Map([...slots].map(([slot, items]) => [slot, Object.freeze(items)]));
  const empty = Object.freeze([]);

  return Object.freeze({ contributions: <K extends keyof Shape & string>(slot: K) => (frozen.get(slot) ?? empty) as readonly Shape[K][] });
}
