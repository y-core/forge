import { v } from "../../validation/validation";

/** Holds an object schema to a JSON object, refusing the array `v.object` would otherwise accept. @internal */
export function jsonTable<TSchema extends v.GenericSchema>(schema: TSchema, message = "must be an object") {
  return v.pipe(
    v.unknown(),
    v.check((value) => !Array.isArray(value), message),
    schema,
  );
}
