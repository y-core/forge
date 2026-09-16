import { stripFences } from "../checks/docs";
import { proseOf } from "../corpus/chunk";
import { type AliasTable, aliasTerms } from "./aliases";
import { terms } from "./query";

/** The columns an excerpt is drawn from — a chunk's own, whether or not it came back from a search. @public */
export interface Excerptable {
  title: string;
  gloss: string;
  rules: string;
  body: string;
}

/** How wide one excerpt may be. */
const WIDTH = 160;

/** How much of the window sits before the term the excerpt was anchored on. */
const LEAD = 40;

/** The fewest words a `rules` value may carry before it is shown to a reader. */
const RULE_WORDS = 5;

// The parent's title is kept and only the `~slug.` prefix goes: dropping the whole segment collapses
// `~http. http › ~exports. Exports` and `~app. app › ~exports. Exports` into one identical line.
const SLUG_PREFIX = /(^|› )~[a-z0-9-]*\. /g;

/** A heading trail as a reader reads it, without the slugs that only ever addressed it. @public */
export function headingTrail(headingPath: string): string {
  return headingPath.replace(SLUG_PREFIX, "$1");
}

/** Whether a term starts a word at `at` — `return` inside `returning`, never inside `unreturned`. */
function wordStart(prose: string, at: number): boolean {
  if (at <= 0) return at === 0;
  return !/[A-Za-z0-9]/.test(prose[at - 1] ?? "");
}

/** The earliest place any of the query's terms is mentioned, or 0 when none of them is. */
function anchor(prose: string, query: string, aliases: AliasTable | undefined): number {
  const typed = terms(query);
  const lower = prose.toLowerCase();
  let earliest = -1;
  // Bridges as well as typed terms: the MATCH expression OR-s them in, so a hit can be ranked
  // entirely on a synonym that never appears in what the reader typed.
  for (const term of [...typed, ...aliasTerms(typed, aliases)]) {
    const needle = term.toLowerCase();
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      if (!wordStart(prose, at)) continue;
      if (earliest === -1 || at < earliest) earliest = at;
      break;
    }
  }
  return earliest === -1 ? 0 : earliest;
}

/** `WIDTH` characters of `prose` around `at`, cut on spaces and elided on whichever side was cut. */
function window(prose: string, at: number): string {
  if (prose.length <= WIDTH) return prose;
  let start = Math.max(0, Math.min(at - LEAD, prose.length - WIDTH));
  if (start > 0) {
    const space = prose.indexOf(" ", start);
    start = space === -1 ? start : space + 1;
  }
  let end = Math.min(prose.length, start + WIDTH);
  if (end < prose.length) {
    const space = prose.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  return `${start > 0 ? "… " : ""}${prose.slice(start, end).trim()}${end < prose.length ? " …" : ""}`;
}

/** The one line that lets a reader judge a hit without reading the section. @public */
export function excerptOf(source: Excerptable, query: string, aliases?: AliasTable): string {
  return oneLine(chosen(source, query, aliases));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function chosen(source: Excerptable, query: string, aliases: AliasTable | undefined): string {
  if (source.gloss !== "") return source.gloss;
  const rules = source.rules.trim();
  if (rules.split(/\s+/).length >= RULE_WORDS) return rules;
  // The same path `searchBody` took at index time: cutting from the raw body could anchor on a term
  // that occurs only inside a fence, which the index never saw.
  const prose = oneLine(proseOf(stripFences(source.body)));
  if (prose === "") return source.title;
  return window(prose, anchor(prose, query, aliases));
}
