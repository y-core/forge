import { stripFences } from "../checks/docs";
import { quickReference } from "../checks/docs-parse";
import type { Chunk, SourceDoc } from "../types";
import { chunkId, headingSlug } from "./ident";

const HEADING = /^(#{2,3}) (.*)$/;
const NUMBERED = /^(\d[A-Za-z0-9]*)\. (.+)$/;
const BOLD = /\*\*([^*]+)\*\*/g;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
// `.` is a token character, so `mod.ts` survives — but so would `budget.`, and a reader searching
// for `budget` would miss the sentence that ends with it. Punctuation followed by whitespace is
// sentence punctuation; punctuation inside a word is part of the identifier.
const SENTENCE_PUNCTUATION = /([A-Za-z0-9`)\]])[.,;:!?]+(?=\s|$)/g;

/** The `title` and `description` a document's frontmatter carries. @public */
export function frontmatter(source: string): { title: string; description: string } {
  if (!source.startsWith("---\n")) return { title: "", description: "" };
  const end = source.indexOf("\n---", 4);
  if (end === -1) return { title: "", description: "" };
  const block = source.slice(4, end);
  const strip = (value: string | undefined) => (value ?? "").trim().replace(/^["']|["']$/g, "");
  return { title: strip(block.match(/^title:\s*(.+)$/m)?.[1]), description: strip(block.match(/^description:\s*(.+)$/m)?.[1]) };
}

/** The per-section summaries of a `## 0. Quick Reference` block, keyed by section number.
 *
 *  The block is never emitted as a chunk of its own: it names every section, so it matches every
 *  query and would win every search. Redistributing each line into the section it names turns the
 *  corpus's best retrieval signal — gate-enforced to be both complete and in step with the headings
 *  it summarises — into a ranked column. The parsing is `quickReference`'s, so the line this indexes
 *  is exactly the line the gate approved. @public */
export function glossary(lines: readonly string[]): Map<string, string> {
  return quickReference(lines);
}

/** The bolded lead clauses of a block — where a governing document states its rule. @public */
export function ruleClauses(block: readonly string[]): string {
  return [...block.join("\n").matchAll(BOLD)].map((match) => (match[1] ?? "").trim().replace(SENTENCE_PUNCTUATION, "$1")).join(" ");
}

/** Prose with links flattened to their text, so a URL never outranks a sentence. @public */
export function proseOf(block: readonly string[]): string {
  return block
    .join("\n")
    .replace(INLINE_LINK, "$1")
    .replace(SENTENCE_PUNCTUATION, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

interface Heading {
  level: number;
  section: string;
  title: string;
  line: number;
}

/** Every `##`/`###` heading of a document, numbered or slugged. @public */
export function headings(lines: readonly string[]): Heading[] {
  const found: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = (lines[i] ?? "").match(HEADING);
    if (!match) continue;
    const [, hashes = "", rest = ""] = match;
    const numbered = rest.match(NUMBERED);
    found.push(
      numbered
        ? { level: hashes.length, section: numbered[1] ?? "", title: numbered[2] ?? "", line: i }
        : { level: hashes.length, section: headingSlug(rest), title: rest, line: i },
    );
  }
  return found;
}

/** Splits one document into leaf chunks.
 *
 *  A `## N.` with `### Na.` children emits a stub carrying only its lead paragraph; the children
 *  carry the rest. No text is indexed twice, so BM25's length normalisation stays honest. @public */
export function chunkDocument(doc: SourceDoc, source: string): Chunk[] {
  const raw = source.split("\n");
  const stripped = stripFences(source);
  const gloss = glossary(stripped);
  // Scanned on the stripped source, not `raw`: a `## Heading` inside a code fence is a line of an
  // example, and taking it as a boundary splits the section it is quoted in. `stripFences` blanks
  // lines rather than removing them, so `heading.line` still indexes into `raw`.
  const found = headings(stripped);

  const chunks: Chunk[] = [];
  const taken = new Set<string>();
  let parent: Heading | undefined;
  let ordinal = 0;

  // A `~slug` corpus repeats headings — a README carries one `### Exports` per sub-path — so the
  // slug is qualified by its parent, and a still-colliding one takes a numeric suffix. An id has to
  // be unique before it can be an address.
  //
  // A repeated `## N.` is a defect `validate-docs` reports, but only in the citable trees: a README
  // with two `## 3.` headings reaches here, and an id that is merely unique is a better answer than
  // a `UNIQUE` violation thrown out of the middle of a build.
  const uniqueSection = (heading: Heading, parentOf: Heading | undefined): string => {
    const qualified =
      heading.section.startsWith("~") && heading.level === 3 && parentOf !== undefined ? `${parentOf.section}${heading.section}` : heading.section;
    let candidate = qualified;
    for (let n = 2; taken.has(candidate); n++) candidate = `${qualified}-${n}`;
    taken.add(candidate);
    return candidate;
  };

  for (const [index, heading] of found.entries()) {
    if (heading.level === 2) parent = heading;
    // The Quick Reference is a map of the document, not a section of it.
    if (heading.section === "0") continue;

    const next = found[index + 1];
    const end = next === undefined ? raw.length : next.line;
    const block = raw.slice(heading.line + 1, end);
    const organising = block.join("").trim() === "" && heading.level === 2 && found[index + 1]?.level === 3;

    const section = uniqueSection(heading, parent);
    const trail =
      heading.level === 3 && parent !== undefined
        ? `${parent.section}. ${parent.title} › ${heading.section}. ${heading.title}`
        : `${heading.section}. ${heading.title}`;
    const searchBody = proseOf(stripped.slice(heading.line + 1, end));
    const glossOf = gloss.get(heading.section) ?? "";
    const rules = ruleClauses(block);
    chunks.push({
      id: chunkId(doc.corpus, doc.path, section),
      section,
      title: heading.title,
      headingPath: trail,
      gloss: glossOf,
      rules,
      searchBody,
      body: block.join("\n").trim(),
      ordinal: ordinal++,
      // Two shapes are emitted but not indexed, because the title is what a reader scans an outline
      // for and the target of every `§N` citation the corpus writes — dropping them made
      // `NAMESPACES.md §3` an id that resolved nowhere.
      //
      // A `## N.` organising `### Na.` children states nothing itself; its title is already carried
      // by every child's heading trail, so indexing it adds a competitor and reaches nothing new.
      // That holds even when the Quick Reference glosses it, which is why `organising` stands
      // beside the emptiness test rather than being subsumed by it.
      //
      // A section that is nothing but a code fence is non-empty raw and empty once stripped, so it
      // could only match on its own title. The gloss and the rules are what make this a guard
      // rather than `searchBody !== ""`: `COLUMN_WEIGHTS` ranks both above the body, so a
      // fence-only section carrying a real Quick Reference line stays reachable by exactly the
      // columns that matter most.
      searchable: !organising && (searchBody !== "" || glossOf !== "" || rules !== ""),
    });
  }

  return chunks;
}
