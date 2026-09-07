# Catalogue

Every document of the fleet canon, with the sentence its own frontmatter uses to describe it. This
is the map an agent is handed before it asks anything: pick a document here, then reach its sections
with `knowledge_outline`, `knowledge_search` or `warden outline <path>`.

Generated — run `warden catalogue --write` after adding, removing or re-describing a document.


## Libraries

- `BOUNDARIES.md` — Library Boundaries: The recurring boundary rulings: SSR versus browser, transport versus application security, validate-at-boundary, no-PII logging, and fail-closed.
- `CODE_REVIEW.md` — Code Review Standards: How to review: the blocking invariants, tiered detection with a command per rule, severity calibration, the verification protocol, and known false positives.
- `CODE_RULES.md` — Code Rules: Seven non-negotiable coding rules: zero global state, explicit errors, validation first, testability, the comment budget, declarative style, and name distinctiveness.
- `ERROR_HANDLING.md` — Error Handling: The one Result primitive and its narrowing rule, how failures cross module and HTTP boundaries, the fail-closed posture, and the error taxonomy.
- `LIBRARY_ARCHITECTURE.md` — Library Architecture: Structural principles: the dependency facade, the runtime-only no-build-step constraint, demand composition, Web-APIs-only, and the isolate model.
- `NAMESPACE_DESIGN.md` — Namespace Design: Barrel discipline and the export-star ban, the no-sibling-barrel rule, leaf-versus-integration classification, naming conventions, and when to add a namespace.
- `TESTING.md` — Testing Discipline: Test placement, the exact-match assertion rule, fakes over mocks, security-test requirements, and the one-command verification gate.

## Shared — every repository, whatever its kind

- `AGENT_GUIDE.md` — Governing Document Guide: How docs/ documents are structured, numbered, sized, cross-referenced, split between governance and implementation, and kept free of duplication.
- `PLAIN_LANGUAGE.md` — Plain Language: Reader-centred prose for governing documents and for what an agent says to a person: relevant, findable, understandable, usable — plus length, narration, and scope.
