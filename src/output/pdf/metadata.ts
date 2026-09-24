import { sha256 } from "../../crypto/digest";
import { pdfTextString } from "./text";
import type { PdfInfo } from "./types";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** A date as PDF's own `D:YYYYMMDDHHmmSSZ` literal, in UTC so a render is not timezone-dependent. @internal */
export function pdfDate(at: Date): string {
  const parts = [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()];
  return `D:${parts.map((part, index) => (index === 0 ? String(part).padStart(4, "0") : twoDigits(part))).join("")}Z`;
}

// XML 1.0's `Char` production excludes most of C0, every lone surrogate and U+FFFE/U+FFFF, and none
// of them is writable as an entity — so a value carrying one is stripped rather than escaped.
const NOT_XML_CHAR = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu;

// Stripped here rather than in the packet, because a value the packet dropped and the dictionary
// kept is two metadata blocks disagreeing — which is what PDF/A refuses a file for.
/** The one `info` both metadata blocks are written from, holding only what XML can carry. @internal */
export function pdfWritableInfo(info: PdfInfo): PdfInfo {
  const carried = (value: string | undefined): string | undefined => value?.replace(NOT_XML_CHAR, "");
  return {
    ...info,
    title: carried(info.title),
    author: carried(info.author),
    subject: carried(info.subject),
    keywords: carried(info.keywords),
    creator: carried(info.creator),
    producer: carried(info.producer),
  };
}

/** The document information dictionary, or nothing where the document carries no metadata. @internal */
export function infoDictionary(info: PdfInfo | undefined): string | undefined {
  if (info === undefined) return undefined;
  const created = info.created ?? info.modified;
  const modified = info.modified ?? info.created;
  const entries: [string, string | undefined][] = [
    ["Title", info.title],
    ["Author", info.author],
    ["Subject", info.subject],
    ["Keywords", info.keywords],
    ["Creator", info.creator],
    ["Producer", info.producer],
    ["CreationDate", created === undefined ? undefined : pdfDate(created)],
    ["ModDate", modified === undefined ? undefined : pdfDate(modified)],
  ];
  const written = entries.filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (written.length === 0) return undefined;
  return `<< ${written.map(([key, value]) => `/${key} ${pdfTextString(value)}`).join(" ")} >>`;
}

const ID_BYTES = 16;

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The file identifier, derived rather than random so two renders of one document are one file. @internal */
export async function fileIdentifier(material: string): Promise<string> {
  const digest = await sha256(material);
  // Both halves are equal because the second differs from the first only after an incremental
  // update, and this writer never produces one.
  const half = `<${hex(digest.slice(0, ID_BYTES))}>`;
  return `[${half} ${half}]`;
}
