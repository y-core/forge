/** The golden retrieval set — the queries a reader actually asks, and where the answer is. */

/** One golden query and what retrieval owes it. @public */
export interface GoldenQuery {
  /** What a reader types. */
  query: string;
  /** The chunk id that must come back, and near the top. */
  expect: string;
  /** How far down the expected hit may sit. Defaults to 3 — a threshold, never an exact rank, so a
   *  prose edit that swaps ranks 1 and 2 cannot fail a build. */
  within?: number;
  /** Ids that must not appear at all. The real hazard here is `src/ui/design/`, whose samples quote
   *  the anti-patterns they forbid — a query for the right answer must not surface the wrong one. */
  absent?: readonly string[];
}

/** Every query the gate holds retrieval to.
 *
 *  Each entry names the **leaf** that answers, not the parent that contains it: chunking emits a
 *  stub for a `## N.` whose children carry the prose, so the section a reader wants is almost always
 *  a `### Na.`. Add an entry whenever tuning moves a rank you cared about — the set only stays
 *  honest if it grows where the tuning happened. @public */
export const GOLDEN: readonly GoldenQuery[] = [
  // --- canon/libs:CODE_RULES.md
  { query: "isolate global state factory", expect: "canon/libs:CODE_RULES.md#1a" },
  { query: "validate untrusted input at the boundary", expect: "canon/libs:CODE_RULES.md#3a" },
  { query: "comment budget", expect: "canon/libs:CODE_RULES.md#5", within: 4 },
  { query: "when do I throw instead of returning a Result", expect: "canon/libs:CODE_RULES.md#2", within: 6 },

  // --- canon/libs:NAMESPACE_DESIGN.md
  { query: "export star ban in a barrel", expect: "canon/libs:NAMESPACE_DESIGN.md#1b" },
  { query: "leaf namespace rules cross-namespace import", expect: "canon/libs:NAMESPACE_DESIGN.md#3a" },

  // --- canon/libs:TESTING.md
  { query: "use a fake not a mock", expect: "canon/libs:TESTING.md#4b" },
  { query: "test file naming convention", expect: "canon/libs:TESTING.md#2a" },

  // --- canon/libs:BOUNDARIES.md
  { query: "never log PII", expect: "canon/libs:BOUNDARIES.md#4a" },
  { query: "fail closed on missing critical context", expect: "canon/libs:BOUNDARIES.md#5a" },

  // --- canon/libs:ERROR_HANDLING.md
  { query: "a failure crossing a namespace boundary", expect: "canon/libs:ERROR_HANDLING.md#2b" },
  { query: "log with context then refuse", expect: "canon/libs:ERROR_HANDLING.md#5c" },

  // --- canon/libs:LIBRARY_ARCHITECTURE.md
  { query: "wrap a dependency behind a facade", expect: "canon/libs:LIBRARY_ARCHITECTURE.md#1a" },

  // --- canon/libs:CODE_REVIEW.md
  { query: "blocking invariant severity calibration", expect: "canon/libs:CODE_REVIEW.md#4" },

  // --- canon/shared:AGENT_GUIDE.md
  { query: "which file owns a fact single home", expect: "canon/shared:AGENT_GUIDE.md#8" },
  { query: "quick reference block lists every section", expect: "canon/shared:AGENT_GUIDE.md#1", within: 3 },

  // --- canon/shared:PLAIN_LANGUAGE.md
  { query: "response length narration to a person", expect: "canon/shared:PLAIN_LANGUAGE.md#8" },

  // --- this repository's own documents
  { query: "how are validation errors returned", expect: "canon/libs:ERROR_HANDLING.md#5a", within: 3 },
  { query: "how does cn resolve conflicting utilities", expect: "local:docs/UI_CLASS_COMPOSITION.md#1a" },
  { query: "class order is not load bearing within a literal", expect: "local:docs/UI_CLASS_COMPOSITION.md#1b" },
  { query: "the utility recipe layer and the tone mechanism", expect: "local:docs/UI_CLASS_COMPOSITION.md#1e" },
  { query: "colour scheme declaration light-dark", expect: "local:docs/UI_CLASS_COMPOSITION.md#2", within: 4 },
  { query: "csp nonce for an inline script", expect: "local:docs/SECURITY_HARDENING.md#2a", within: 6 },
  { query: "where does a new SSR component go", expect: "local:docs/NAMESPACES.md#5b" },
  { query: "exact match assertions html entities", expect: "local:docs/TESTING.md#3b" },
  { query: "csrf token field", expect: "local:docs/INPUT_VALIDATION.md#3a", within: 4 },
  { query: "route map and controller", expect: "local:docs/ROUTING_AND_MIDDLEWARE.md#1b", within: 4 },
  { query: "mount controller disposer contract", expect: "local:docs/UI_CLIENT_RUNTIME.md#2d" },
  { query: "verification gate modes and the only flag", expect: "canon/libs:TESTING.md#6a" },
  { query: "cli commands are values", expect: "local:docs/BUILD_TOOLING.md#1a" },
];
