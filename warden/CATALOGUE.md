# Catalogue

Every document of the fleet canon, with the sentence its own frontmatter uses to describe it. This
is the map an agent is handed before it asks anything: pick a document here, then reach its sections
with `knowledge_outline`, `knowledge_search` or `warden outline <path>`.

Generated — run `warden catalogue --write` after adding, removing or re-describing a document.


## Applications

- `APP_ARCHITECTURE.md` — Application Architecture: The composition-root factory, the layer stack and its dependency rules, dependency injection through config, concern-first placement, and the feature sequence.
- `BOUNDARIES.md` — Application Boundaries: SSR versus browser, middleware ordering and guard placement, validate-at-boundary, no-PII logging, and the fail-closed posture.
- `CODE_REVIEW.md` — Code Review Standards: How to review an application: the blocking invariants, tiered detection with a command per rule, severity calibration, verification, and known false positives.
- `CONFIG_BASELINE.md` — Application Configuration Baseline: The tsconfig flags, oxlint base and overrides, gate wiring, script set and tool pins every Worker application in this fleet shares, and the rule for what may vary.
- `ERROR_HANDLING.md` — Error Handling: The one Result primitive, how failures cross a layer boundary, the fragment-versus-page rendering decision, and the three-way error taxonomy.
- `FORGE_CONSUMPTION.md` — Shared Library Consumption: Leverage the shared library before writing app code, never bypass its facade, and the test for working around a gap locally versus upstreaming a change.
- `TESTING.md` — Testing Discipline: The app-request pattern, environment fixtures, exact-match assertions and entity encoding, fakes over mocks, fail-closed expectations, and the gate.
- `WORKERS_PLATFORM.md` — Workers Platform: The V8 isolate model and what module scope may hold, post-response work, rate limiting, deploy safety and secret handling, and static asset serving.

## Libraries

- `BOUNDARIES.md` — Library Boundaries: The recurring boundary rulings: SSR versus browser, transport versus application security, validate-at-boundary, no-PII logging, and fail-closed.
- `CODE_REVIEW.md` — Code Review Standards: How to review: the blocking invariants, tiered detection with a command per rule, severity calibration, the verification protocol, and known false positives.
- `ERROR_HANDLING.md` — Error Handling: The one Result primitive and its narrowing rule, how failures cross module and HTTP boundaries, the fail-closed posture, and the error taxonomy.
- `LIBRARY_ARCHITECTURE.md` — Library Architecture: Structural principles: the dependency facade, the runtime-only no-build-step constraint, demand composition, Web-APIs-only, and the isolate model.
- `NAMESPACE_DESIGN.md` — Namespace Design: Barrel discipline and the export-star ban, the no-sibling-barrel rule, leaf-versus-integration classification, naming conventions, and when to add a namespace.
- `TESTING.md` — Testing Discipline: Test placement, the exact-match assertion rule, fakes over mocks, security-test requirements, and the one-command verification gate.

## Shared — every repository, whatever its kind

- `AGENT_GUIDE.md` — Governing Document Guide: How docs/ documents are structured, numbered, sized, cross-referenced, split between governance and implementation, and kept free of duplication.
- `AGENT_WORKFLOW.md` — Agent Workflow: How an agent works in any repository: the posture it holds to, the tools it reaches for, the exit-status spelling, when the gate is delegated, and the ledger rhythm.
- `CODE_RULES.md` — Code Rules: The non-negotiable coding rules: zero global state, explicit errors, validation first, testability, the comment budget, declarative style, and name distinctiveness.
- `PLAIN_LANGUAGE.md` — Plain Language: Reader-centred prose for governing documents and for what an agent says to a person: relevant, findable, understandable, usable — plus length, narration, and scope.
