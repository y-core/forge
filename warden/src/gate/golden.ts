/** The golden retrieval set — the queries a reader actually asks, and where the answer is. */

/** The kind of question a golden query asks.
 *
 *  **Adapted, not invented.** Sillito et al. (FSE 2006) catalogued the questions programmers ask
 *  while working on unfamiliar code; these five are the categories a governing corpus is asked in.
 *  `placement` is "where does this go?", `prohibition` "what am I forbidden to do?", `procedure`
 *  "how do I do this?", `rationale` "why is it this way?", and `boundary` "what may reach what?".
 *  Tag a new entry by the question, never by the document it lands in. @public */
export type Dimension = "placement" | "prohibition" | "procedure" | "rationale" | "boundary";

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
  /** Which kind of question this is, for the per-dimension rollup. */
  dimension?: Dimension;
}

/** Questions this corpus does not answer, which retrieval must refuse rather than answer badly.
 *
 *  **The set the golden queries cannot replace.** A golden query proves the right section is
 *  reachable; none of them can prove a wrong section is not offered, because every query they hold
 *  retrieval to has an answer. Without these the floor could be deleted and the gate would stay
 *  green — which is how retrieval shipped with no floor at all.
 *
 *  **What this set can and cannot hold retrieval to.** Every entry names a concept the corpus has no
 *  vocabulary for, and it is the absent terms that defeat them: coverage weights a term the index
 *  has never seen at twice its rarest, so a query carrying one cannot reach the floor. A question
 *  whose every word the corpus does know, asked of a subject it does not cover, is not refusable
 *  this way and no entry here pretends otherwise — `how are database migrations versioned` peaks at
 *  0.679, above every golden query's own coverage, because `database`, `migration` and `version` all
 *  live here and co-occur. Refusing that would mean refusing real questions. It is the standing
 *  limit of a lexical floor, not a gap to be closed by lowering the bar elsewhere. @public */
export const NEGATIVE: readonly string[] = [
  "what is the retry policy for flaky payment webhooks",
  "how do I configure the kubernetes ingress controller",
  "which grpc interceptor handles tracing",
  "what is the refund window for annual subscriptions",
  "does the router support websockets",
];

/** Every query the gate holds retrieval to.
 *
 *  Each entry names the **leaf** that answers, not the parent that contains it: chunking emits a
 *  stub for a `## N.` whose children carry the prose, so the section a reader wants is almost always
 *  a `### Na.`. Add an entry whenever tuning moves a rank you cared about — the set only stays
 *  honest if it grows where the tuning happened. @public */
export const GOLDEN: readonly GoldenQuery[] = [
  // --- canon:CODE_RULES.md
  { query: "isolate global state factory", expect: "canon:CODE_RULES.md#1a", dimension: "prohibition" },
  { query: "validate untrusted input at the boundary", expect: "canon:CODE_RULES.md#3a", dimension: "boundary" },
  { query: "comment budget", expect: "canon:CODE_RULES.md#5", within: 4, dimension: "prohibition" },
  { query: "when do I throw instead of returning a Result", expect: "canon:CODE_RULES.md#2", within: 6, dimension: "procedure" },

  // --- canon:NAMESPACE_DESIGN.md
  { query: "export star ban in a barrel", expect: "canon:NAMESPACE_DESIGN.md#1b", dimension: "prohibition" },
  { query: "leaf namespace rules cross-namespace import", expect: "canon:NAMESPACE_DESIGN.md#3a", dimension: "boundary" },

  // --- canon:TESTING.md
  { query: "use a fake not a mock", expect: "canon:TESTING.md#4b", dimension: "prohibition" },
  { query: "test file naming convention", expect: "canon:TESTING.md#2a", dimension: "placement" },

  // --- canon:BOUNDARIES.md
  { query: "never log PII", expect: "canon:BOUNDARIES.md#4a", dimension: "prohibition" },
  { query: "fail closed on missing critical context", expect: "canon:BOUNDARIES.md#5a", dimension: "boundary" },

  // --- canon:ERROR_HANDLING.md
  { query: "a failure crossing a namespace boundary", expect: "canon:ERROR_HANDLING.md#2b", dimension: "boundary" },
  { query: "log with context then refuse", expect: "canon:ERROR_HANDLING.md#5c", dimension: "procedure" },

  // --- canon:LIBRARY_ARCHITECTURE.md
  { query: "wrap a dependency behind a facade", expect: "canon:LIBRARY_ARCHITECTURE.md#1a", dimension: "boundary" },

  // --- canon:CODE_REVIEW.md
  { query: "blocking invariant severity calibration", expect: "canon:CODE_REVIEW.md#4", dimension: "procedure" },

  // --- canon:AGENT_GUIDE.md
  { query: "which file owns a fact single home", expect: "canon:AGENT_GUIDE.md#8", dimension: "placement" },
  { query: "quick reference block lists every section", expect: "canon:AGENT_GUIDE.md#7", within: 3, dimension: "procedure" },
  { query: "how do I look up a governing rule", expect: "canon:AGENT_GUIDE.md#1", within: 3, dimension: "procedure" },

  // --- canon:AGENT_WORKFLOW.md
  { query: "how do I report a command's exit status", expect: "canon:AGENT_WORKFLOW.md#3", dimension: "procedure" },
  { query: "who runs the full verification gate", expect: "canon:AGENT_WORKFLOW.md#4", dimension: "procedure" },
  { query: "may I add a runtime dependency", expect: "canon:AGENT_WORKFLOW.md#1", dimension: "prohibition" },
  { query: "ripgrep or the language server for finding references", expect: "canon:AGENT_WORKFLOW.md#2", dimension: "procedure" },
  { query: "when do I move a task to done", expect: "canon:AGENT_WORKFLOW.md#5", dimension: "procedure" },

  // --- canon:PLAIN_LANGUAGE.md
  { query: "response length narration to a person", expect: "canon:PLAIN_LANGUAGE.md#8", dimension: "procedure" },

  // --- this repository's own documents
  { query: "how are validation errors returned", expect: "canon:ERROR_HANDLING.md#5a", within: 3, dimension: "procedure" },
  { query: "how does cn resolve conflicting utilities", expect: "project:docs/UI_CLASS_COMPOSITION.md#1a", dimension: "rationale" },
  { query: "class order is not load bearing within a literal", expect: "project:docs/UI_CLASS_COMPOSITION.md#1b", dimension: "rationale" },
  { query: "the utility recipe layer and the tone mechanism", expect: "project:docs/UI_CLASS_COMPOSITION.md#1e", dimension: "rationale" },
  { query: "colour scheme declaration light-dark", expect: "project:docs/UI_CLASS_COMPOSITION.md#2", within: 4, dimension: "procedure" },
  { query: "csp nonce for an inline script", expect: "project:docs/SECURITY_HARDENING.md#2a", within: 6, dimension: "procedure" },
  { query: "where does a new SSR component go", expect: "project:docs/NAMESPACES.md#5b", dimension: "placement" },
  { query: "exact match assertions html entities", expect: "project:docs/TESTING.md#3b", dimension: "prohibition" },
  { query: "csrf token field", expect: "project:docs/INPUT_VALIDATION.md#3a", within: 4, dimension: "procedure" },
  { query: "route map and controller", expect: "project:docs/ROUTING_AND_MIDDLEWARE.md#1b", within: 4, dimension: "rationale" },
  { query: "mount controller disposer contract", expect: "project:docs/UI_CLIENT_RUNTIME.md#2d", dimension: "procedure" },
  { query: "may a verification step be skipped", expect: "canon:TESTING.md#6a", dimension: "prohibition" },
  { query: "cli commands are values", expect: "project:docs/BUILD_TOOLING.md#1a", dimension: "rationale" },

  // --- what the coverage blend and the placement bridges bought, held so it cannot be lost
  { query: "how many comments am I allowed to write", expect: "canon:CODE_RULES.md#5a", dimension: "prohibition" },
  { query: "where do I put a new CORS middleware", expect: "project:docs/NAMESPACES.md#5a", within: 3, dimension: "placement" },
  { query: "where does a new browser controller belong", expect: "project:docs/NAMESPACES.md#5f", within: 3, dimension: "placement" },
  { query: "where does a new gate check go", expect: "project:docs/NAMESPACES.md#5g", within: 3, dimension: "placement" },
  { query: "where does API key rotation belong", expect: "project:docs/NAMESPACES.md#5a", within: 3, dimension: "placement" },
  { query: "deprecation shim before 1.0", expect: "project:docs/LIBRARY_ARCHITECTURE.md#7", within: 3, dimension: "prohibition" },

  // --- the design corpus, which competes on a gloss of its own only since it was numbered
  { query: "empty state for a list", expect: "project:src/ui/design/floor.md#1g", within: 3, dimension: "procedure" },
  { query: "focus ring on a custom control", expect: "project:src/ui/design/reference/09-interaction.md#1a", within: 3, dimension: "procedure" },
  { query: "which component confirms a destructive action", expect: "project:src/ui/design/catalog.md#2a", within: 4, dimension: "procedure" },
];
