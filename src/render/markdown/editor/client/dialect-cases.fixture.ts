/** A dialect construct both the renderer and the editor recognise. */
export type ConstructName = "tag" | "wikilink" | "embed" | "highlight" | "due" | "strikethrough";

/** A markdown input with the dialect constructs it holds, each named by its source text and located left to right. */
export interface DialectCase {
  readonly name: string;
  readonly markdown: string;
  readonly spans: readonly { readonly construct: ConstructName; readonly text: string }[];
}

const PAGE = "0190c7a0-0000-7000-8000-000000000001";
const ATT = "0190c7a0-0000-7000-8000-0000000000aa";
const LONGEST_TARGET = "a".repeat(999);

function none(name: string, markdown: string): DialectCase {
  return { name, markdown, spans: [] };
}

function one(name: string, markdown: string, construct: ConstructName, text: string = markdown): DialectCase {
  return { name, markdown, spans: [{ construct, text }] };
}

/** Inputs the renderer and the editor must read alike, construct by construct. */
export const DIALECT_CASES: readonly DialectCase[] = [
  none("a single tilde pair", "~x~"),
  one("a double tilde pair", "~~x~~", "strikethrough"),
  none("a triple tilde pair inside a line", "a ~~~x~~~ b"),
  none("subscript and superscript markers", "H~2~O and x^2^"),
  none("an emoji shortcode", ":smile:"),

  one("a tag after a word", "see #finance", "tag", "#finance"),
  one("a tag in parentheses", "(#t)", "tag", "#t"),
  one("a nested tag", "#area/sub", "tag"),
  one("a tag of non-ASCII letters", "#Ünïcode", "tag"),
  one("a tag with a decomposed accent", "#cafe\u0301", "tag"),
  one("a tag before a trailing slash", "#a/", "tag", "#a"),
  one("a tag before sentence punctuation", "#t.", "tag", "#t"),
  one("a tag in strong emphasis", "**#t**", "tag", "#t"),
  one("a tag in a heading", "# Title #t", "tag", "#t"),
  one("a tag in square brackets", "[#notatag]", "tag", "#notatag"),
  none("a # before a combining mark", "#\u0301a"),
  none("a # before a digit", "#1"),
  none("a # inside a word", "a#b"),
  none("a # after a slash", "x/#y"),
  none("a # after another #", "##t"),
  none("an escaped #", "\\#t"),
  none("a tag in inline code", "`#t`"),
  none("a tag in a fenced block", "```\n#t\n```"),
  none("an ATX heading marker", "# heading"),
  none("an entity-encoded #", "&#35;t"),
  none("a tag in link text", "[see #finance](u)"),
  none("a tag in an image's alt", "![a #t b](u)"),

  one("a highlight", "a ==hi== b", "highlight", "==hi=="),
  one("a highlight holding a spaced ==", "x ==a == b== y", "highlight", "==a == b=="),
  one("a highlight holding emphasis", "==*x*==", "highlight"),
  one("a highlight across a line ending", "==a\nb==", "highlight"),
  one("a highlight in a table cell", "| h |\n|---|\n| ==x== |", "highlight", "==x=="),
  {
    name: "two highlights on one line",
    markdown: "==x== ==y==",
    spans: [
      { construct: "highlight", text: "==x==" },
      { construct: "highlight", text: "==y==" },
    ],
  },
  none("== surrounded by spaces", "a == b"),
  none("a single = pair", "=x="),
  none("a triple = run", "===x==="),
  none("an escaped ==", "\\==x=="),
  none("an unclosed ==", "==x"),
  none("a setext underline of ==", "a\n=="),
  none("a highlight in inline code", "`==hi==`"),

  one("a page link", `[[${PAGE}]]`, "wikilink"),
  one("a labelled page link", `[[${PAGE}|Budget]]`, "wikilink"),
  one("a heading link", `[[${PAGE}#q3-goals|Goals]]`, "wikilink"),
  one("a section link", `[[s:${PAGE}|Clients]]`, "wikilink"),
  one("a notebook link", `[[NB:${PAGE}]]`, "wikilink"),
  one("an unresolved title link", "[[ Budget ]]", "wikilink"),
  one("an att: link without the !", `[[att:${ATT}]]`, "wikilink"),
  one("a wikilink with the longest target", `[[${LONGEST_TARGET}]]`, "wikilink"),
  one("a wikilink beside a matching reference definition", "[[x]]\n\n[x]: /u", "wikilink", "[[x]]"),
  one("a wikilink with an escaped pipe in a table cell", `| [[${PAGE}\\|L]] |\n|---|`, "wikilink", `[[${PAGE}\\|L]]`),
  one("a wikilink whose label holds a tag", `[[${PAGE}|see #finance]]`, "wikilink"),
  none("a wikilink split by a bare pipe in a table", `| [[${PAGE}|L]] |\n|---|---|`),
  none("an empty wikilink", "[[]]"),
  none("a wikilink with a single closing bracket", "[[a]b]]"),
  none("a wikilink broken by a line ending", "[[a\nb]]"),
  none("a wikilink target one past the longest", `[[${"a".repeat(1000)}]]`),
  none("a wikilink whose target and label exceed the longest", `[[${"a".repeat(500)}|${"b".repeat(500)}]]`),
  none("a wikilink in link text", "[[[x]]](u)"),
  none("a wikilink in an image's alt", "![see [[x]]](u)"),

  one("an attachment embed", `![[att:${ATT}|Receipt]]`, "embed"),
  one("an attachment embed with no alt", `![[ATT:${ATT}]]`, "embed"),
  none("an embed naming no attachment", "![[Title]]"),

  one("a due: date on a task", "- [ ] pay due:2026-10-01", "due", "due:2026-10-01"),
  one("a calendar-emoji date on a task", "- [ ] pay 📅 2026-10-01", "due", "📅 2026-10-01"),
  one("a calendar-emoji date with no space on a task", "- [ ] a 📅2026-10-01", "due", "📅2026-10-01"),
  one("a due date on a done task", "- [x] a due:2026-10-01", "due", "due:2026-10-01"),
  one("a due date on an ordered task", "1. [ ] a due:2026-10-01", "due", "due:2026-10-01"),
  one("a leap-day due date", "- [ ] a due:2024-02-29", "due", "due:2024-02-29"),
  one("a due date before sentence punctuation", "- [ ] a due:2026-10-01.", "due", "due:2026-10-01"),
  {
    name: "a due date on a task and on its nested task",
    markdown: "- [ ] p due:2026-10-01\n  - [ ] c due:2026-11-01",
    spans: [
      { construct: "due", text: "due:2026-10-01" },
      { construct: "due", text: "due:2026-11-01" },
    ],
  },
  none("a due: date outside a task", "pay due:2026-10-01 please"),
  none("a calendar-emoji date outside a task", "pay 📅 2026-10-01 please"),
  none("overdue: on a task", "- [ ] a overdue:2026-10-01"),
  none("a due date running into another digit", "- [ ] a due:2026-10-011"),
  none("a due date with a two-digit year", "- [ ] a due:26-10-01"),
  none("a due date with a month past 12", "- [ ] a due:2026-13-01"),
  none("29 February outside a leap year", "- [ ] a due:2025-02-29"),
  none("due: followed by a space", "- [ ] a due: 2026-10-01"),
  none("a calendar emoji followed by two spaces", "- [ ] a 📅  2026-10-01"),
  none("an uppercase DUE:", "- [ ] a DUE:2026-10-01"),
  none("a due date in a task's second paragraph", "- [ ] a\n\n  b due:2026-10-01"),
  none("a due date in inline code on a task", "- [ ] `due:2026-10-01`"),

  {
    name: "a tag inside a highlight",
    markdown: "==a #t==",
    spans: [
      { construct: "highlight", text: "==a #t==" },
      { construct: "tag", text: "#t" },
    ],
  },
  {
    name: "a tag inside strikethrough",
    markdown: "~~#t~~",
    spans: [
      { construct: "strikethrough", text: "~~#t~~" },
      { construct: "tag", text: "#t" },
    ],
  },
  {
    name: "a highlight inside strikethrough",
    markdown: "~~==x==~~",
    spans: [
      { construct: "strikethrough", text: "~~==x==~~" },
      { construct: "highlight", text: "==x==" },
    ],
  },
  one("a tag in a callout title", "> [!note] T #tag", "tag", "#tag"),
  one("a tag between raw HTML lines", "<div>\n#x\n</div>", "tag", "#x"),
  {
    name: "tags through a nested list, with the due date only on the task",
    markdown: "- a #t\n  - b #u due:2030-01-01\n    - [ ] c due:2030-01-02",
    spans: [
      { construct: "tag", text: "#t" },
      { construct: "tag", text: "#u" },
      { construct: "due", text: "due:2030-01-02" },
    ],
  },
];
