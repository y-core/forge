import { defineRules } from "../../define";

export default defineRules([
  {
    id: "libs-error-handling-result-literal",
    statement: "Build a Result with `ok()` or `err()`, never as an object literal.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\{\s*ok:\s*(?:true|false)\b`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "*.workerd.*", "src/result/**"],
        level: "warn",
        triage:
          "A type annotation spelling the shape, or an expected value a spec compares against, is fine; a Result built by hand in source is the defect.",
      },
    ],
  },
]);
