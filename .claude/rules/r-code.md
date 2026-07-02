# r-code — TypeScript/Workers Coding Rules

> Ruleset for `cc-dev`. Read entirely before writing code.

---

## TypeScript Patterns

### Naming Conventions

- **Functions**: camelCase, verb-first (`getUser`, `parseUrl`, `createSecurityHeaders`, `createD1Client`)
- **Errors**: named `Error` subclasses or sentinel strings (`ErrNotFound`, `class CsrfError extends Error`)
- **Types/Interfaces**: PascalCase (`SecurityHeadersOptions`, `KVStore`, `RouteConfig`)
- **Constructors/Factories**: `create*` prefix for factory functions (`createApp`, `createSecurityHeaders`) — never `make*`; `resolve*` for request-time binding accessors (`resolveKVStore`)
- **Option/shape types**: `*Config` = validated data shape (`CsrfConfig`); `*Options` = factory/function behavior config (`SecurityHeadersOptions`); `*Definition` = declarative handler/component shape (`PageDefinition`, `NavDefinition`); `*Descriptor`/`*Def` = fine-grained declarative member shapes (`FieldDescriptor`, `FlagDef`). See NAMESPACE_DESIGN.md §5e.
- **Test fakes**: `fake` prefix (`fakeKV`, `fakeLogger`, `fakeContext`)
- **Constants**: SCREAMING_SNAKE_CASE for module-level constants (`CSRF_FIELD_DEFAULT`, `NONCE`)

### Structure

- Early returns over nested conditions
- One exported function per exported concern — no multi-purpose helpers
- Factory functions accept dependencies as parameters (no global mutable state; see PRODUCTION_TS_RULES.md §1)
- Web-APIs-only: `fetch`, `Request`, `Response`, `Headers`, `URL`, `crypto.subtle`, `TextEncoder` — never `process.env`, `require()`, `Bun.file()`, Node.js `fs`/`path`/`crypto`
- Prefer declarative constructs: array methods, object spread, nullish coalescing over imperative loops and mutation
- TSDoc on all exported symbols: one-line minimum; `@internal` for non-public; `@example` for complex APIs

### External Module Imports

- Forge namespace imports use `@y-core/forge/{namespace}` — never reach into `node_modules` directly for wrapped dependencies (`valibot`, `@remix-run/*`)
- Within forge source, import from concrete source files (`./csrf.ts`), never from a sibling `mod.ts` barrel
- `validation/mod` and `crypto/mod` are exempt from the no-sibling-barrel rule (biome enforces this; see NAMESPACE_DESIGN.md §2)
- Never add `export * from ...` — named exports only in all `mod.ts` files

### Error Handling

- Use `Result<T, E>` from `@y-core/forge/result` for operations that can fail with expected errors
- Use `ValidationResult` for validation operations
- Throw only for programming errors, missing required bindings at startup, and invariants
- Never throw from middleware that should gracefully degrade

### Validation

- Validate all untrusted input at system boundaries (handler entry points, config loaders)
- Always use the `v` facade from `@y-core/forge/validation` — never import `valibot` directly
- Use `{ abortEarly: true }` in `v.safeParse` for form validation

---

## Where to Put New Code

1. **Determine namespace** — leaf or integration? (see NAMESPACE_DESIGN.md §4); confirm the correct `src/{namespace}/` directory
2. **Co-locate with implementation** — new file `src/{namespace}/foo.ts` gets test file `src/{namespace}/foo.test.ts` in the same directory
3. **Add to mod.ts barrel** — every new public symbol must appear as a named export in `src/{namespace}/mod.ts`; import from the concrete file, not a sibling barrel
4. **Internal utilities** — place in `src/context/` or `src/crypto/` with `@internal` JSDoc tag; do NOT add these to `package.json` exports

Consult NAMESPACE_DESIGN.md for the authoritative namespace catalog and LIBRARY_ARCHITECTURE.md for dependency tier rules. All code in this repository is forge library code — it must be reusable, Web-APIs-only, and runtime-portable.
