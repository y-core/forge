import type { JsonPath, Primitive } from "../../cli/jsonc";

export type { JsonPath, Primitive };

export type ConfigDiff = { kind: "set"; path: JsonPath; value: Primitive } | { kind: "unsupported"; path: JsonPath; reason: string };

function isPrimitive(v: unknown): v is Primitive {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** A general deep diff between the config as parsed and the config as the handlers left it. */
export function diffConfig(original: unknown, updated: unknown, path: JsonPath = []): ConfigDiff[] {
  if (Object.is(original, updated)) return [];

  if (isPrimitive(original) && isPrimitive(updated)) {
    return original === updated ? [] : [{ kind: "set", path, value: updated }];
  }

  if (Array.isArray(original) && Array.isArray(updated)) {
    if (original.length !== updated.length) {
      return [{ kind: "unsupported", path, reason: `array length changed (${original.length} → ${updated.length})` }];
    }
    return original.flatMap((item, i) => diffConfig(item, updated[i], [...path, i]));
  }

  if (isPlainObject(original) && isPlainObject(updated)) {
    const diffs: ConfigDiff[] = [];

    for (const key of Object.keys(original)) {
      if (!(key in updated)) {
        diffs.push({ kind: "unsupported", path: [...path, key], reason: "key removed" });
      }
    }

    for (const [key, next] of Object.entries(updated)) {
      const here: JsonPath = [...path, key];
      if (!(key in original)) {
        // An addition is expressible only when it is a single primitive member —
        // splicing in a whole nested container is not something this writer does.
        if (isPrimitive(next)) diffs.push({ kind: "set", path: here, value: next });
        else diffs.push({ kind: "unsupported", path: here, reason: `added ${typeName(next)} value` });
        continue;
      }
      diffs.push(...diffConfig((original as Record<string, unknown>)[key], next, here));
    }

    return diffs;
  }

  return [{ kind: "unsupported", path, reason: `type changed (${typeName(original)} → ${typeName(updated)})` }];
}
