/** The markdown conventions forge's gate holds its own prose to. */

import type { MarkdownCheckConfig } from "../src/tooling/gate/mod";

export default {
  sources: ["src", "docs", "warden", "README.md", "CLAUDE.md", "AGENTS.md"],
  exclude: ["CHANGELOG.md", "warden/CATALOGUE.md", ".claude", "tmp"],
  rules: {
    tables: "compact",
    bulletMarker: "-",
    orderedMarker: ".",
    listIndent: "content-column",
    emphasis: { strong: "**", em: "_" },
    fence: { style: "backtick", requireLanguage: true, aliases: { typescript: "ts", sh: "bash" } },
    hardTabs: "forbid",
    trailingWhitespace: { allowHardBreak: 2 },
    thematicBreak: "---",
    linkStyle: "reference",
    bareUrls: "fail",
    singleH1: true,
    blankLineAround: ["heading", "fence", "table", "list", "blockquote"],
    // 148 is `.oxfmtrc.json`'s `printWidth`, so prose and TypeScript wrap at the same column.
    lineLength: { limit: 148, level: "fail", exempt: ["link", "table", "heading", "fence"] },
  },
} satisfies Omit<MarkdownCheckConfig, "root">;
