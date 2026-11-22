// Generated from src/validation/mod.ts by `bun run gen:bundles` — do not edit.

// src/validation/validation.ts
import * as v from "valibot";

// src/validation/form-digits.ts
var NON_DIGITS = /\D/g;
function formDigits() {
  return v.pipe(
    v.string(),
    v.transform((value) => value.replace(NON_DIGITS, ""))
  );
}

// src/validation/form-text.ts
var CRLF = /\r\n/g;
function formText() {
  return v.pipe(v.string(), v.trim());
}
function formMultilineText() {
  return v.pipe(
    v.string(),
    v.transform((value) => value.replace(CRLF, "\n")),
    v.trim()
  );
}

// src/validation/safe-check.ts
var VOUCHED = /* @__PURE__ */ new WeakMap();
function safeCheck(requirement, message) {
  VOUCHED.set(requirement, message);
  return v.check(requirement, message);
}

// src/validation/format-issues.ts
var UNNAMED_FIELD = "the submitted form";
var PATH_DEPTH_MAX = 3;
var PATH_SEGMENT_MAX = 40;
function describeValidationField(path) {
  const bounded = path.slice(0, PATH_DEPTH_MAX).map((segment) => segment.slice(0, PATH_SEGMENT_MAX));
  return bounded.length === 0 ? UNNAMED_FIELD : bounded.join(".");
}
function issuePathSegments(issue) {
  return (issue.path ?? []).map((item) => item.key).filter((key) => typeof key === "string" || typeof key === "number").map(String);
}
function describeValidationIssue(issue) {
  return describeValidationField(issuePathSegments(issue));
}
export {
  describeValidationIssue,
  formDigits,
  formMultilineText,
  formText,
  safeCheck,
  v
};
