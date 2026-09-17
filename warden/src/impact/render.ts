import type { Impact } from "./impact";

const span = (range: { start: number; end: number }): string => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`);

/** The impact report as the text both the CLI and the MCP tool return. @public */
export function renderImpact(report: Impact): string {
  const lines: string[] = [];

  if (report.touched.length === 0) {
    lines.push(`no governing section changed in ${report.ref}`);
  }

  for (const section of report.touched) {
    lines.push(`changed  ${section.id} (lines ${section.lines.map(span).join(", ")})`);
    lines.push(`         ${section.headingPath}`);
    for (const dependent of section.dependents) lines.push(`  depends on it  ${dependent}`);
    for (const bound of section.governs) lines.push(`  governs        ${bound.subpath}${bound.target === undefined ? "" : ` → ${bound.target}`}`);
    lines.push("");
  }

  if (report.unindexed.length > 0) {
    lines.push(`not indexed: ${report.unindexed.join(", ")}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
