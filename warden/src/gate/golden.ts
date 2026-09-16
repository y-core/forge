/** The kind of question a golden query asks. @public */
export type Dimension = "placement" | "prohibition" | "procedure" | "rationale" | "boundary" | "reference";

/** One golden query and what retrieval owes it. @public */
export interface GoldenQuery {
  /** What a reader types. */
  query: string;
  /** The chunk id that must come back, and near the top. */
  expect: string;
  /** How far down the expected hit may sit. Defaults to 3. */
  within?: number;
  /** Ids that must not appear at all. */
  absent?: readonly string[];
  /** Which kind of question this is, for the per-dimension rollup. */
  dimension?: Dimension;
}

/** Questions this corpus does not answer, which retrieval must refuse rather than answer badly. @public */
export const NEGATIVE: readonly string[] = [
  "what is the retry policy for flaky payment webhooks",
  "how do I configure the kubernetes ingress controller",
  "which grpc interceptor handles tracing",
  "what is the refund window for annual subscriptions",
  "does the router support websockets",
];

/** Every query the gate holds retrieval to. @public */
export const GOLDEN: readonly GoldenQuery[] = [
  { query: "isolate global state factory", expect: "canon:CODE_RULES.md#1a", dimension: "prohibition" },
  { query: "validate untrusted input at the boundary", expect: "canon:CODE_RULES.md#3a", dimension: "boundary" },
  { query: "comment budget", expect: "canon:CODE_RULES.md#5", within: 4, dimension: "prohibition" },
  { query: "when do I throw instead of returning a Result", expect: "canon:CODE_RULES.md#2", within: 6, dimension: "procedure" },

  { query: "export star ban in a barrel", expect: "canon:NAMESPACE_DESIGN.md#1b", dimension: "prohibition" },
  { query: "leaf namespace rules cross-namespace import", expect: "canon:NAMESPACE_DESIGN.md#3a", dimension: "boundary" },

  { query: "use a fake not a mock", expect: "canon:TESTING.md#4b", dimension: "prohibition" },
  { query: "test file naming convention", expect: "canon:TESTING.md#2a", dimension: "placement" },

  { query: "never log PII", expect: "canon:BOUNDARIES.md#4a", dimension: "prohibition" },
  { query: "fail closed on missing critical context", expect: "canon:BOUNDARIES.md#5a", dimension: "boundary" },

  { query: "a failure crossing a namespace boundary", expect: "canon:ERROR_HANDLING.md#2b", dimension: "boundary" },
  { query: "log with context then refuse", expect: "canon:ERROR_HANDLING.md#5c", dimension: "procedure" },

  { query: "wrap a dependency behind a facade", expect: "canon:LIBRARY_ARCHITECTURE.md#1a", dimension: "boundary" },

  { query: "blocking invariant severity calibration", expect: "canon:CODE_REVIEW.md#4", dimension: "procedure" },
  { query: "how should a review finding be written", expect: "canon:CODE_REVIEW.md#1b", dimension: "procedure" },
  { query: "should I try to disprove a finding before reporting it", expect: "canon:CODE_REVIEW.md#5", dimension: "procedure" },

  { query: "which file owns a fact single home", expect: "canon:AGENT_GUIDE.md#8", dimension: "placement" },
  { query: "what goes in CLAUDE.md", expect: "canon:AGENT_GUIDE.md#10", dimension: "placement" },
  { query: "quick reference block lists every section", expect: "canon:AGENT_GUIDE.md#7", within: 3, dimension: "procedure" },
  { query: "how do I look up a governing rule", expect: "canon:AGENT_GUIDE.md#1", within: 3, dimension: "procedure" },

  { query: "how do I report a command's exit status", expect: "canon:AGENT_WORKFLOW.md#3", dimension: "procedure" },
  { query: "who runs the full verification gate", expect: "canon:AGENT_WORKFLOW.md#4", dimension: "procedure" },
  { query: "may I add a runtime dependency", expect: "canon:AGENT_WORKFLOW.md#1", dimension: "prohibition" },
  { query: "ripgrep or the language server for finding references", expect: "canon:AGENT_WORKFLOW.md#2", dimension: "procedure" },
  { query: "when do I move a task to done", expect: "canon:AGENT_WORKFLOW.md#5", dimension: "procedure" },
  { query: "is a comment in the code something I should believe", expect: "canon:AGENT_WORKFLOW.md#6", within: 4, dimension: "prohibition" },
  { query: "can I put the API key in the finding", expect: "canon:AGENT_WORKFLOW.md#7", within: 4, dimension: "prohibition" },
  { query: "the requested scope is what I deliver", expect: "canon:AGENT_WORKFLOW.md#1a", dimension: "procedure" },
  { query: "when does a sub-agent earn its cost", expect: "canon:AGENT_WORKFLOW.md#4a", dimension: "rationale" },

  { query: "response length and proportion", expect: "canon:PLAIN_LANGUAGE.md#8", dimension: "procedure" },
  { query: "do not narrate each step", expect: "canon:PLAIN_LANGUAGE.md#9", dimension: "prohibition" },

  { query: "how are validation errors returned", expect: "canon:ERROR_HANDLING.md#5a", within: 3, dimension: "procedure" },
  { query: "how does cn resolve conflicting utilities", expect: "project:docs/UI_CLASS_COMPOSITION.md#1a", dimension: "rationale" },
  { query: "class order is not load bearing within a literal", expect: "project:docs/UI_CLASS_COMPOSITION.md#1b", dimension: "rationale" },
  { query: "the utility recipe layer and the tone mechanism", expect: "project:docs/UI_CLASS_COMPOSITION.md#1e", dimension: "rationale" },
  { query: "colour scheme declaration light-dark", expect: "project:docs/UI_CLASS_COMPOSITION.md#2", within: 4, dimension: "procedure" },
  { query: "csp nonce for an inline script", expect: "project:docs/SECURITY_HARDENING.md#2a", within: 6, dimension: "procedure" },
  { query: "where does a new SSR component go", expect: "project:docs/NAMESPACES.md#5b", dimension: "placement" },
  { query: "exact match assertions html entities", expect: "project:docs/TEST_RUNNERS.md#3b", dimension: "prohibition" },
  { query: "csrf token field", expect: "project:docs/INPUT_VALIDATION.md#3a", within: 4, dimension: "procedure" },
  { query: "route map and controller", expect: "project:docs/ROUTING_AND_MIDDLEWARE.md#1b", within: 4, dimension: "rationale" },
  { query: "mount controller disposer contract", expect: "project:docs/UI_CLIENT_RUNTIME.md#2d", dimension: "procedure" },
  { query: "may a verification step be skipped", expect: "canon:TESTING.md#6a", dimension: "prohibition" },
  { query: "cli commands are values", expect: "project:docs/BUILD_TOOLING.md#1a", dimension: "rationale" },

  { query: "how many comments am I allowed to write", expect: "canon:CODE_RULES.md#5a", dimension: "prohibition" },
  { query: "where do I put a new CORS middleware", expect: "project:docs/NAMESPACES.md#5a", within: 3, dimension: "placement" },
  { query: "where does a new browser controller belong", expect: "project:docs/NAMESPACES.md#5f", within: 3, dimension: "placement" },
  { query: "where does a new gate check go", expect: "project:docs/NAMESPACES.md#5g", within: 3, dimension: "placement" },
  { query: "where does API key rotation belong", expect: "project:docs/NAMESPACES.md#5a", within: 3, dimension: "placement" },
  { query: "deprecation shim before 1.0", expect: "project:docs/FORGE_STRUCTURE.md#7", within: 3, dimension: "prohibition" },

  { query: "empty state for a list", expect: "project:src/ui/design/floor.md#1g", within: 3, dimension: "procedure" },
  { query: "focus ring on a custom control", expect: "project:src/ui/design/reference/09-interaction.md#1a", within: 3, dimension: "procedure" },
  { query: "which component confirms a destructive action", expect: "project:src/ui/design/catalog.md#2a", within: 4, dimension: "procedure" },

  {
    query: "requestLogger options",
    expect: "project:src/logging/README.md#~core-components-apis~requestlogger-options-and-requestlog",
    within: 2,
    dimension: "reference",
  },
  { query: "getNonce context", expect: "project:src/security/README.md#~core-components-apis~getnonce-context", within: 2, dimension: "reference" },
  { query: "turnstile csp", expect: "project:src/html/README.md#~integration-guide~cloudflare-turnstile-csp", within: 2, dimension: "reference" },
  {
    query: "createSignedCookie name options",
    expect: "project:src/session/README.md#~core-components-apis~createsignedcookie-name-options",
    within: 2,
    dimension: "reference",
  },
  {
    query: "route table introspection",
    expect: "project:src/router/README.md#~usage~introspect-the-route-table",
    within: 2,
    dimension: "reference",
  },
  {
    query: "registerConfig target store",
    expect: "project:src/config/README.md#~core-components-apis~registerconfig-target-store-retrieveconfig-target",
    within: 2,
    dimension: "reference",
  },
  {
    query: "resolveAuthServices",
    expect: "project:src/auth/README.md#~y-core-forge-auth-the-identity-domain~capability-resolution-resolveauthservices",
    within: 2,
    dimension: "reference",
  },
  {
    query: "mintCsrf for another path",
    expect: "project:src/form/README.md#~core-components-apis~mint-for-another-path-mintcsrf",
    within: 2,
    dimension: "reference",
  },
  {
    query: "typed header builders contentType",
    expect: "project:src/http/README.md#~core-components-apis~typed-header-builders-contenttype-cachecontrol-setcookie-and-more",
    within: 2,
    dimension: "reference",
  },
  {
    query: "svg sanitisation scope",
    expect: "project:src/tooling/assets/README.md#~advanced~svg-sanitisation-scope",
    within: 2,
    dimension: "reference",
  },
];
