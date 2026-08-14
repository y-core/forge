import { v } from "./validation";

/** A strict object schema whose entries bag carries no prototype, so only a field the schema actually declares counts as declared. @public */
export function strictObject<const TEntries extends v.ObjectEntries>(entries: TEntries): v.StrictObjectSchema<TEntries, undefined>;
export function strictObject<const TEntries extends v.ObjectEntries, const TMessage extends v.ErrorMessage<v.StrictObjectIssue> | undefined>(
  entries: TEntries,
  message: TMessage,
): v.StrictObjectSchema<TEntries, TMessage>;
export function strictObject<TEntries extends v.ObjectEntries>(
  entries: TEntries,
  message?: v.ErrorMessage<v.StrictObjectIssue>,
): v.StrictObjectSchema<TEntries, v.ErrorMessage<v.StrictObjectIssue> | undefined> {
  // Valibot tests declaredness with `key in schema.entries`; on a prototype-backed bag every inherited name reads as declared.
  const owned: TEntries = Object.assign(Object.create(null), entries);
  return message === undefined ? v.strictObject(owned) : v.strictObject(owned, message);
}
