import type { InlineConstruct, InlineMatch } from "./types";

const LATIN_SMALL_D = 0x64;
const CALENDAR_HIGH_SURROGATE = 0xd83d;
const CALENDAR_LOW_SURROGATE = 0xdcc5;
const SPACE = 0x20;
const HYPHEN = 0x2d;
const DUE_KEYWORD = "due:";
const DATE_LENGTH = 10;
const DATE_HYPHENS: ReadonlySet<number> = new Set([4, 7]);
const WHITESPACE = /\s/;
const MAX_LENGTH = DUE_KEYWORD.length + DATE_LENGTH + 1;

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAsciiAlphanumeric(code: number): boolean {
  return isDigit(code) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function canPrecedeDue(previous: number): boolean {
  return previous < 0 || WHITESPACE.test(String.fromCharCode(previous));
}

function dateEnd(content: string, start: number, limit: number): number {
  for (let index = 0; index < DATE_LENGTH; index++) {
    if (start + index >= limit) return -1;
    const code = content.charCodeAt(start + index);
    if (DATE_HYPHENS.has(index) ? code !== HYPHEN : !isDigit(code)) return -1;
  }
  const end = start + DATE_LENGTH;
  return end < limit && isAsciiAlphanumeric(content.charCodeAt(end)) ? -1 : end;
}

function scanDue(content: string, at: number, limit: number): InlineMatch | null {
  if (!canPrecedeDue(at > 0 ? content.charCodeAt(at - 1) : -1)) return null;
  let dateStart = -1;
  if (content.startsWith(DUE_KEYWORD, at)) dateStart = at + DUE_KEYWORD.length;
  else if (content.charCodeAt(at) === CALENDAR_HIGH_SURROGATE && content.charCodeAt(at + 1) === CALENDAR_LOW_SURROGATE) {
    dateStart = content.charCodeAt(at + 2) === SPACE ? at + 3 : at + 2;
  }
  if (dateStart < 0) return null;
  const end = dateEnd(content, dateStart, limit);
  if (end < 0) return null;
  return { end, node: { type: "taskDue", date: content.slice(end - DATE_LENGTH, end), start: at, end } };
}

function isCalendarDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** The `due:YYYY-MM-DD` and 📅 construct, kept only in a task item's first paragraph and only for a real calendar date. */
export const TASK_DUE_CONSTRUCT: InlineConstruct = {
  name: "taskDue",
  triggers: [LATIN_SMALL_D, CALENDAR_HIGH_SURROGATE],
  maxLength: MAX_LENGTH,
  scan: scanDue,
  accept: (node, { inImage, leaf, leafIndex, container }) =>
    !inImage &&
    leaf.type === "paragraph" &&
    leafIndex === 0 &&
    container?.type === "listItem" &&
    container.checked !== null &&
    node.type === "taskDue" &&
    isCalendarDate(node.date),
};
