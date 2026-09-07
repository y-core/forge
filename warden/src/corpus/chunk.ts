import { stripFences } from "../checks/docs";
import type { Chunk, SourceDoc } from "../types";
import { chunkId, headingSlug } from "./ident";

const HEADING = /^(#{2,3}) (.*)$/;
const NUMBERED = /^(\d[A-Za-z0-9]*)\. (.+)$/;
const QUICK_REFERENCE = /^## 0\. /;
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
 *  corpus's best retrieval signal — already gate-enforced to be complete — into a ranked column. @public */
export function glossary(lines: readonly string[]): Map<string, string> {
  const start = lines.findIndex((line) => QUICK_REFERENCE.test(line));
  if (start === -1) return new Map();
  const gloss = new Map<string, string>();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) break;
    const match = line.match(/^\s*[-*]\s*§([0-9][A-Za-z0-9]*)\s+(.*)$/);
    if (match) gloss.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return gloss;
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
  const found = headings(raw);

  const chunks: Chunk[] = [];
  const taken = new Set<string>();
  let parent: Heading | undefined;
  let ordinal = 0;

  // A `~slug` corpus repeats headings — a README carries one `### Exports` per sub-path — so the
  // slug is qualified by its parent, and a still-colliding one takes a numeric suffix. An id has to
  // be unique before it can be an address.
  const uniqueSection = (heading: Heading, parentOf: Heading | undefined): string => {
    if (!heading.section.startsWith("~")) return heading.section;
    const qualified = heading.level === 3 && parentOf !== undefined ? `${parentOf.section}${heading.section}` : heading.section;
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
    if (block.join("").trim() === "" && heading.level === 2 && found[index + 1]?.level === 3) {
      // A parent whose lead paragraph is empty carries nothing its children do not.
      continue;
    }

    const section = uniqueSection(heading, parent);
    const trail =
      heading.level === 3 && parent !== undefined
        ? `${parent.section}. ${parent.title} › ${heading.section}. ${heading.title}`
        : `${heading.section}. ${heading.title}`;
    chunks.push({
      id: chunkId(doc.corpus, doc.tree, doc.path, section),
      section,
      title: heading.title,
      headingPath: trail,
      gloss: gloss.get(heading.section) ?? "",
      rules: ruleClauses(block),
      searchBody: proseOf(stripped.slice(heading.line + 1, end)),
      body: block.join("\n").trim(),
      ordinal: ordinal++,
    });
  }

  return chunks;
}
