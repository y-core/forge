import type { GoldenQuery } from "@y-core/forge/warden";

/** The retrieval set `warden:queries` holds this repository's index to, one top hit at least for every canon document. */
export const QUERIES: readonly GoldenQuery[] = [
  { query: "a controller must not import another controller", expect: "canon:APP_ARCHITECTURE.md#2b", dimension: "prohibition" },
  { query: "never read a raw binding for a configured value", expect: "canon:APP_ARCHITECTURE.md#3a", dimension: "prohibition" },
  { query: "views are pure and never call a service", expect: "canon:APP_ARCHITECTURE.md#2d", dimension: "boundary" },
  { query: "handler calls fetch directly instead of a service", expect: "canon:APP_ARCHITECTURE.md#2c", dimension: "reference" },
  { query: "review output format for a finding", expect: "canon:CODE_REVIEW.md#1b", dimension: "reference" },
  { query: "isolate global state factory", expect: "canon:CODE_RULES.md#1a", dimension: "prohibition" },
  { query: "comment budget", expect: "canon:CODE_RULES.md#5a", dimension: "prohibition" },
  { query: "validate untrusted input at the boundary", expect: "canon:CODE_RULES.md#3a", dimension: "boundary" },
  { query: "search the governing corpus before inferring a rule", expect: "canon:AGENT_GUIDE.md#1", dimension: "procedure" },
  { query: "move a task to review with a resolution", expect: "canon:AGENT_WORKFLOW.md#4b", dimension: "procedure" },
  { query: "write for the reader plain language", expect: "canon:PLAIN_LANGUAGE.md#2", dimension: "procedure" },
  { query: "no PII in logs", expect: "canon:BOUNDARIES.md#4a", dimension: "prohibition" },
  { query: "fail closed on missing critical context", expect: "canon:BOUNDARIES.md#5a", dimension: "boundary" },
  { query: "tsconfig extends the forge base", expect: "canon:CONFIG_BASELINE.md#1", dimension: "reference" },
  { query: "oxlint base and its overrides", expect: "canon:CONFIG_BASELINE.md#2a", dimension: "reference" },
  { query: "startup invariants config throws", expect: "canon:ERROR_HANDLING.md#5d", dimension: "rationale" },
  { query: "leverage the library first before writing code", expect: "canon:FORGE_CONSUMPTION.md#1a", dimension: "placement" },
  { query: "security surface never worked around locally", expect: "canon:FORGE_CONSUMPTION.md#3d", dimension: "prohibition" },
  { query: "exact match never substring matching on markup", expect: "canon:TESTING.md#3a", dimension: "prohibition" },
  { query: "waitUntil post-response work", expect: "canon:WORKERS_PLATFORM.md#2a", dimension: "procedure" },
  { query: "rate limit binding absent fails closed", expect: "canon:WORKERS_PLATFORM.md#3b", dimension: "boundary" },
];
