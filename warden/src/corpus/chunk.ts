import { stripFences } from "../checks/docs";
import { quickReference } from "../checks/docs-parse";
import type { Chunk, SourceDoc } from "../types";
import { chunkId, headingSlug } from "./ident";

const HEADING = /^(#{2,3}) (.*)$/;
const NUMBERED = /^(\d[A-Za-z0-9]*)\. (.+)$/;
const BOLD = /\*\*([^*]+)\*\*/g;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]+\S.*$/gm;
// `.` is a token character to the tokenizer, so `budget.` would not match a search for `budget`:
// punctuation followed by whitespace is sentence punctuation, inside a word it is the identifier's.
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

/** The per-section summaries of a `## 0. Quick Reference` block, keyed by section number. @public */
export function glossary(lines: readonly string[]): Map<string, string> {
  return quickReference(lines);
}

/** The bolded lead clauses of a block — where a governing document states its rule. @public */
export function ruleClauses(block: readonly string[]): string {
  return [...block.join("\n").matchAll(BOLD)].map((match) => (match[1] ?? "").trim().replace(SENTENCE_PUNCTUATION, "$1")).join(" ");
}

/** Prose with links flattened to their text and definition lines dropped, so a URL never outranks a sentence. @public */
export function proseOf(block: readonly string[]): string {
  return block
    .join("\n")
    .replace(LINK_DEFINITION, "")
    .replace(INLINE_LINK, "$1")
    .replace(REFERENCE_LINK, "$1")
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

/** Splits one document into leaf chunks, a `## N.` with `### Na.` children keeping only its lead paragraph. @public */
export function chunkDocument(doc: SourceDoc, source: string): Chunk[] {
  const raw = source.split("\n");
  const stripped = stripFences(source);
  const gloss = glossary(stripped);
  // Scanned on the stripped source: `stripFences` blanks lines rather than removing them, so
  // `heading.line` still indexes into `raw`.
  const found = headings(stripped);

  const chunks: Chunk[] = [];
  const taken = new Set<string>();
  let parent: Heading | undefined;
  let ordinal = 0;

  // A `~slug` corpus repeats headings — a README carries one `### Exports` per sub-path — so the
  // slug is qualified by its parent, and a still-colliding one takes a numeric suffix.
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
      line: heading.line + 1,
      endLine: end,
      // Emitted but unranked rather than dropped: the title is the target of every `§N` citation
      // the corpus writes, so dropping the chunk leaves `NAMESPACES.md §3` resolving nowhere.
      searchable:
        !organising && !(doc.corpus === "dependency" && section.endsWith("~exports")) && (searchBody !== "" || glossOf !== "" || rules !== ""),
    });
  }

  return chunks;
}
