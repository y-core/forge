/** The markdown conventions forge's gate holds its own prose to. */

import type { MarkdownCheckConfig } from "../src/tooling/gate/mod";

// `root` is the step table's to supply: it is derived from this repository's location, not stated here.
export default {
  sources: ["src", "docs", "warden", "README.md", "CLAUDE.md", "AGENTS.md"],
  // `.claude/` is written by `warden sync` from `warden/claude/`, which is checked instead — the
  // source owns the bytes, so formatting it is what keeps the copy conforming. `CHANGELOG.md` is
  // the release tooling's, and `warden/CATALOGUE.md` is `warden catalogue --write`'s: one bullet per
  // document, whose width is the document's own frontmatter sentence and not an author's wrap.
  exclude: ["CHANGELOG.md", "warden/CATALOGUE.md", ".claude", "tmp"],
  rules: {
    tables: "compact",
    bulletMarker: "-",
    orderedMarker: ".",
    listIndent: "content-column",
    emphasis: { strong: "**", em: "_" },
    // The corpus's majority spellings: `ts` over `typescript`, `bash` over `sh`.
    fence: { style: "backtick", requireLanguage: true, aliases: { typescript: "ts", sh: "bash" } },
    hardTabs: "forbid",
    trailingWhitespace: { allowHardBreak: 2 },
    thematicBreak: "---",
    linkStyle: "reference",
    bareUrls: "fail",
    singleH1: true,
    blankLineAround: ["heading", "fence", "table", "list", "blockquote"],
    // 148 is `.oxfmtrc.json`'s `printWidth`, so prose and TypeScript wrap at the same column and a
    // document quoting code keeps both under one rule. The exemptions are the lines whose width is
    // not the author's to choose.
    lineLength: { limit: 148, level: "fail", exempt: ["link", "table", "heading", "fence"] },
  },
} satisfies Omit<MarkdownCheckConfig, "root">;
