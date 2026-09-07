/** The markdown conventions forge's gate holds its own prose to. */

import type { MarkdownCheckConfig } from "../src/tooling/gate/mod";

// `root` is the step table's to supply: it is derived from this repository's location, not stated here.
export default {
  sources: ["src", "docs", "warden", "README.md", "CLAUDE.md", "AGENTS.md"],
  // `.claude/` is written by `warden sync` from `warden/claude/`, which is checked instead — the
  // source owns the bytes, so formatting it is what keeps the copy conforming. `CHANGELOG.md` is
  // the release tooling's.
  exclude: ["CHANGELOG.md", ".claude", "tmp"],
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
    linkStyle: "inline",
    bareUrls: "warn",
    singleH1: true,
    blankLineAround: ["heading", "fence", "table", "list", "blockquote"],
    // Off: the corpus wraps at 100 by habit but overruns it on 502 lines — many by a trailing link
    // or a `<!-- rule:… -->` marker that cannot move — so the rule would print noise on every run
    // rather than a signal. Turn it back on with `{ limit, level, scope }` once a tree holds the wrap.
    lineLength: false,
  },
} satisfies Omit<MarkdownCheckConfig, "root">;
