# r-plan — Architecture & Planning Rules

> Ruleset for `cc-plan`. Read entirely before producing any plan.

---

## Pre-Planning Checklist

1. **Namespace?** Leaf or Integration? — see NAMESPACE_DESIGN.md §4
2. **Already exists?** Use LSP (`lsp_workspace_symbols`, `lsp_find_references`) and `grep` on `mod.ts` before proposing new code.
3. **Minimum change?** No abstractions, helpers, or new namespaces not required by the task.

---

## Feature Development Sequence (7-step order)

1. **Identify namespace placement** — leaf or integration? (see NAMESPACE_DESIGN.md §4); confirm no undeclared cross-namespace dependencies are introduced
2. **Check existing exports** — run `lsp_workspace_symbols` and grep `mod.ts` to confirm the symbol does not already exist
3. **Add types/interfaces** — define TypeScript types and interfaces in the namespace source files
4. **Implement functions** — write concrete implementation in `src/{namespace}/` source files; Web APIs only; factory functions for stateful behavior
5. **Add exports to mod.ts** — named exports only; never `export *`; import from concrete files not from sibling mod.ts barrels
6. **Write co-located tests** — `src/{namespace}/foo.ts` → `src/{namespace}/foo.test.ts` (delegate to `cc-test`)
7. **Run bun run check** — all four steps must pass: typecheck (tsgo) + lint (biome) + test (bun test) + validate-exports

Never skip or reorder steps.

---

## Namespace Placement Checklist

Before adding code to any namespace, confirm:

- [ ] Is this a leaf namespace (zero cross-namespace forge imports) or integration namespace (explicitly composes across namespaces)?
- [ ] Does the new code belong in an existing namespace, or does it require a new one? (see NAMESPACE_DESIGN.md §6 criteria)
- [ ] Are all imports from concrete source files (not sibling mod.ts barrels)?
- [ ] Does the implementation use only Web APIs? (no Node.js, no Bun-specific APIs)
- [ ] Is there an existing exported symbol that already covers this need?
- [ ] Will the new export be added to the namespace `mod.ts` barrel with a named export?

---

## Error Classification

| Category | Type | Location | When |
|----------|------|----------|------|
| Domain | named Error classes or sentinel strings (`ErrNotFound`) | namespace source files | Expected business failures |
| Application | `Result<T, Error>` or thrown `Error` with message | function return type | Parse/validation failures, transport-facing errors |
| Infrastructure | plain `throw new Error(...)` | anywhere | Unexpected; startup invariants, missing bindings |

Functions that can fail with expected errors return `Result<T, E>` (from `@y-core/forge/result`). Functions that validate input return `ValidationResult`. Services never throw for expected failures.

---

## Plan Output Format

Every plan MUST include:

```markdown
## Context
Why this change is needed; what problem it solves.

## Layer Placement
Which namespace(s) are affected and why (leaf or integration). Confirm no layer violations.

## Files to Modify / Create
| Action | File | What changes |

## Implementation Steps
Numbered, ordered steps. Each step references a specific file and function.

## New Types / Interfaces
Any new TypeScript types, interfaces, or error classes with their signatures.

## Test Plan
What cc-test should verify (happy path + failure cases).
```
