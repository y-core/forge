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

/** How wide one excerpt may be. A hit is one line of a ranked list, not a section. */
const WIDTH = 160;

/** How much of the window sits before the term the excerpt was anchored on. */
const LEAD = 40;

/** The fewest words a `rules` value may carry before it is shown to a reader.
 *
 *  **Set from the corpus, not from taste.** `ruleClauses` concatenates every `**bold**` run of a
 *  section with a space and filters nothing, so the column is a rule clause in a governing document
 *  and a bag of emphasised words in a README. `warden probe`'s `## rules` block is the audit: of the
 *  260 gloss-less chunks carrying a value, everything under five words is noise — `and`, `not`,
 *  `Returns Throws`, `Read Edit not` — and real clauses (`Keys not declared in \`entries\` are
 *  stripped`) sit above it. Rejecting a borderline value costs nothing, because the next arm of the
 *  chain is an excerpt of the section's own prose. Re-run that block before moving this. */
const RULE_WORDS = 5;

/** The noisy slug a `~heading` section carries into its own trail.
 *
 *  The parent's **title** is kept and only the `~slug.` prefix goes: dropping the whole segment
 *  collapses `~http. http › ~exports. Exports` and `~app. app › ~exports. Exports` into two
 *  identical `Exports` lines, and the trail is built from the raw slug rather than the uniquified
 *  one, so the disambiguator is not there to save it. */
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
  // entirely on a synonym that never appears in what the reader typed, and anchoring on the typed
  // words alone would cut the excerpt somewhere that explains a match which did not happen.
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

/** The one line that lets a reader judge a hit without reading the section.
 *
 *  **Four arms, and the last is not decorative.** The gloss is the corpus's own summary and leads;
 *  `rules` is the highest-weighted column in the index and is what ranked 37% of the corpus, so a
 *  reader who is never shown it has to spend a call to find out why a hit came back; an excerpt cut
 *  around the query's own terms explains the rest. A section that is nothing but a code fence is
 *  deliberately searchable on `gloss`/`rules` alone, so all three can be empty — the title is what
 *  makes this total, and this never returns `""`.
 *
 *  Cut from `proseOf(stripFences(body))`, which is the path `searchBody` took at index time. Cutting
 *  from the raw body would render fence content and could anchor on a term occurring only inside a
 *  fence — text the index never saw — producing an excerpt for a match that did not happen.
 *
 *  **One line, always.** `proseOf` collapses spaces and tabs but keeps the newlines, and both
 *  reader-facing surfaces separate one hit from the next with a blank line — so an excerpt spanning
 *  a paragraph break renders as two hits, and a caller counting blocks counts wrong. @public */
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
  const prose = oneLine(proseOf(stripFences(source.body)));
  if (prose === "") return source.title;
  return window(prose, anchor(prose, query, aliases));
}
