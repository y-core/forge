import { defineRules } from "../../define";

export default defineRules([
  {
    id: "agent-workflow-exit-suffix",
    statement:
      'Where a command\'s exit status must be stated explicitly, append exactly `; echo "EXIT:$?"` to it, with no `&&` before it, no pipe in the statement and no variant.',
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`&&\s*echo\s+"?EXIT|\|[^;]*;\s*echo\s+"EXIT:|\b(?:exit|RC)=\$\?`,
        paths: ["warden/claude/", "docs/"],
        level: "warn",
        triage: "A line quoting a refused form to explain why it is refused is fine; a command written to be run with one is the defect.",
      },
    ],
  },
]);
