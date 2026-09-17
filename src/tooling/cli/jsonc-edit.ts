import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { formatPath, parseJsoncTree, skipTrivia } from "./jsonc";
import type { JsonPath, JsoncMember, JsoncNode, Primitive } from "./types";
import type { JsoncEdit, JsoncEditError } from "./types";

/** A byte-range replacement. Every change to the file is expressed as one of these. */
interface Splice {
  start: number;
  end: number;
  text: string;
}

function editError(message: string, path?: JsonPath): Result<never, JsoncEditError> {
  return err({ message, path });
}

/** Offset of the start of the line containing `i`. */
function lineStart(src: string, i: number): number {
  return src.lastIndexOf("\n", Math.max(0, i - 1)) + 1;
}

/** The leading whitespace of the line containing `i`, or "" if the line has other content first. */
function indentAt(src: string, i: number): string {
  const start = lineStart(src, i);
  const lead = src.slice(start, i);
  return /^[ \t]*$/.test(lead) ? lead : "";
}

function skipTrailingLineComment(src: string, i: number): number {
  let j = i;
  while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
  if (src[j] === "/" && src[j + 1] === "/") {
    while (j < src.length && src[j] !== "\n") j++;
    return j;
  }
  if (src[j] === "/" && src[j + 1] === "*") {
    const close = src.indexOf("*/", j + 2);
    if (close !== -1 && !src.slice(j, close).includes("\n")) return close + 2;
  }
  return i;
}

/** The comma after a member, if the source already has one. */
function existingCommaAt(src: string, afterValue: number): number | undefined {
  const j = skipTrivia(src, afterValue);
  return src[j] === "," ? j : undefined;
}

function spliceInsertMembers(src: string, obj: JsoncNode & { kind: "object" }, members: { key: string; value: Primitive }[]): Splice[] {
  const render = (m: { key: string; value: Primitive }) => `${JSON.stringify(m.key)}: ${JSON.stringify(m.value)}`;
  const inline = members.map(render).join(", ");

  if (obj.members.length === 0) {
    const inner = src.slice(obj.start + 1, obj.end - 1);
    const newlineIndex = inner.indexOf("\n");
    if (newlineIndex === -1) {
      return [{ start: obj.start, end: obj.end, text: `{ ${inline} }` }];
    }
    const closeIndent = indentAt(src, obj.end - 1);
    const nl = inner[newlineIndex - 1] === "\r" ? "\r\n" : "\n";
    const body = members.map((m) => `${nl}${closeIndent}  ${render(m)}`).join(",");
    return [{ start: obj.start, end: obj.end, text: `{${body}${nl}${closeIndent}}` }];
  }

  const last = obj.members[obj.members.length - 1];
  if (last === undefined) return [];
  const comma = existingCommaAt(src, last.end);
  const afterComma = comma !== undefined ? comma + 1 : last.end;
  const afterComment = skipTrailingLineComment(src, afterComma);

  const nlIndex = src.indexOf("\n", afterComment);
  const singleLine = nlIndex === -1 || nlIndex >= obj.end;

  if (singleLine) {
    return [{ start: afterComma, end: afterComma, text: comma === undefined ? `, ${inline}` : ` ${inline}` }];
  }

  const crlf = src[nlIndex - 1] === "\r";
  const insertAt = crlf ? nlIndex - 1 : nlIndex;
  const nl = crlf ? "\r\n" : "\n";
  const indent = indentAt(src, last.keyStart);

  const splices: Splice[] = [];
  // The comma goes against the value, before the comment, so the comment keeps pointing at its own member.
  if (comma === undefined) splices.push({ start: last.end, end: last.end, text: "," });
  const body = members.map((m) => `${nl}${indent}${render(m)}`).join(",");
  splices.push({ start: insertAt, end: insertAt, text: body });
  return splices;
}

type ObjectNode = JsoncNode & { kind: "object" };

type Resolved = { kind: "splices"; splices: Splice[] } | { kind: "insert"; obj: ObjectNode; key: string; value: Primitive };

function resolveEdit(root: JsoncNode, edit: JsoncEdit): Result<Resolved, JsoncEditError> {
  const { path, value } = edit;
  if (path.length === 0) return editError("cannot replace the root value", path);

  let node = root;
  for (let depth = 0; depth < path.length; depth++) {
    const seg = path[depth];
    if (seg === undefined) return editError(`no segment at depth ${depth}`, path);
    const last = depth === path.length - 1;

    if (typeof seg === "number") {
      if (node.kind !== "array") return editError(`expected an array at ${formatPath(path.slice(0, depth))}`, path);
      const element = node.elements[seg];
      if (element === undefined) {
        return editError(`no element at index ${seg} — this writer only edits values that already have a slot`, path);
      }
      if (last) return replaceValue(element, value, path);
      node = element;
      continue;
    }

    if (node.kind !== "object") return editError(`expected an object at ${formatPath(path.slice(0, depth))}`, path);
    // The last duplicate wins, which is what `JSON.parse` and wrangler both read. Editing the first
    // would report `ok` while the value the tool actually loads stayed exactly as it was.
    const member: JsoncMember | undefined = node.members.findLast((m) => m.key === seg);

    if (member === undefined) {
      if (!last) return editError(`no such key: ${formatPath(path.slice(0, depth + 1))}`, path);
      return ok({ kind: "insert", obj: node, key: seg, value });
    }

    if (last) return replaceValue(member.value, value, path);
    node = member.value;
  }

  return editError("unreachable path resolution", path);
}

function replaceValue(target: JsoncNode, value: Primitive, path: JsonPath): Result<Resolved, JsoncEditError> {
  if (target.kind === "object" || target.kind === "array") {
    return editError(`refusing to overwrite an ${target.kind} at ${formatPath(path)} with a single value`, path);
  }
  return ok({ kind: "splices", splices: [{ start: target.start, end: target.end, text: JSON.stringify(value) }] });
}

/** Applies `edits` to `src`, touching only the bytes each edit names. */
export function applyJsoncEdits(src: string, edits: JsoncEdit[]): Result<string, JsoncEditError> {
  if (edits.length === 0) return ok(src);

  const tree = parseJsoncTree(src);
  if (!tree.ok) return editError(`could not parse the config for editing: ${tree.error.message} at offset ${tree.error.offset}`);

  const splices: Splice[] = [];
  const insertions = new Map<number, { obj: ObjectNode; members: { key: string; value: Primitive }[] }>();

  for (const edit of edits) {
    if (typeof edit.value === "object" && edit.value !== null) {
      return editError(`only primitive values can be written; ${formatPath(edit.path)} is not one`, edit.path);
    }
    const resolved = resolveEdit(tree.data, edit);
    if (!resolved.ok) return resolved;

    if (resolved.data.kind === "splices") {
      splices.push(...resolved.data.splices);
      continue;
    }

    const { obj, key, value } = resolved.data;
    const group = insertions.get(obj.start) ?? { obj, members: [] };
    group.members.push({ key, value });
    insertions.set(obj.start, group);
  }

  for (const { obj, members } of insertions.values()) {
    splices.push(...spliceInsertMembers(src, obj, members));
  }

  const ordered = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.start < prev.end) {
      return editError(`edits overlap in the source between offsets ${cur.start} and ${prev.end}`);
    }
  }

  let out = src;
  for (const splice of [...ordered].reverse()) {
    out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  }
  return ok(out);
}
