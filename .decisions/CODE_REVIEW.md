---
title: Code Review Standards
description: "code review workflow, namespace boundary compliance, barrel discipline, Web-APIs-only check, export star ban, no-sibling-barrel, security review, facade compliance, severity calibration, valid patterns, verification protocol, HTMX guard review, bun run check gate"
weight: 42
---

# Code Review Standards

> Authoritative source for reviewing forge code: facade compliance, namespace boundary
> discipline, security, severity calibration, and verification protocol.
>
> Complements [NAMESPACE_DESIGN.md](./NAMESPACE_DESIGN.md) (barrel rules),
> [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) (dependency tiers),
> [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) (security checklist).

---

## 0. Quick Reference

- §1 Review workflow: pre-review, during, output format
- §2 Facade and namespace checklist: export rules, sibling imports, Web-APIs-only
- §3 Security review checklist: no hardcoded secrets, CSP, CSRF location, origin checks
- §4 Testing checklist: co-location, entity encoding, security pass+fail
- §5 Severity calibration: critical, major, minor, informational
- §6 Verification protocol: rules before reporting
- §7 Valid patterns: do not flag these

---

## 1. Review Workflow

### 1a. Pre-Review Preparation

1. Run `bun run check` — verify baseline passes before reviewing changes
2. Check which namespaces are affected
3. Read affected `mod.ts` files to understand public surface changes
4. For security namespace changes: read [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) §7 (boundary)

### 1b. During Review Process

- Work through each checklist category (§2–§4) in order
- For each finding, verify per §6 before reporting
- Classify every finding by severity (§5)

### 1c. Review Output Format

    [FILE:LINE] ISSUE_TITLE
    Severity: Critical | Major | Minor | Informational
    Description and why it matters.

Group by file, then severity (critical first).

---

## 2. Facade and Namespace Compliance Checklist

### 2a. Barrel Discipline Review

- [ ] No `export * from './foo'` in any `mod.ts`
- [ ] Every new exported symbol added to `mod.ts`
- [ ] `bun run validate-exports` passes
- [ ] No `@y-core/forge/context` or `@y-core/forge/crypto` imports from outside forge (internal only)

    ## EXAMPLE — incorrect barrel
    // mod.ts
    export * from './helpers'   // BANNED: collapses public surface, no named enumeration

    ## EXAMPLE — correct barrel
    // mod.ts
    export { makeSecurityHeaders, mergeSecurityHeaders } from './headers'
    export { getNonce } from './nonce'

### 2b. No-Sibling-Barrel Import Rule

- [ ] No `../sibling/mod` imports in source files (biome catches this)
- [ ] Exemptions: `validation/mod` and `crypto/mod` are explicitly allowed
- [ ] `biome lint` passes (catches `noRestrictedImports` violations)

    ## EXAMPLE — forbidden
    // src/router/routes.ts
    import { something } from '../security/mod'   // BANNED: sibling barrel import

    ## EXAMPLE — allowed exemption
    // src/form/csrf.ts
    import { timingSafeEqual } from '../crypto/mod'   // OK: crypto is an exempt internal

### 2c. Web-APIs-Only Check

- [ ] No `process.env`, `require()`, `Bun.file()`, `fs.*`, `path.*` in source files
- [ ] Only Web API globals: `fetch`, `crypto`, `TextEncoder`, `URL`, `Request`, `Response`
- [ ] No Node.js built-in imports (`node:fs`, `node:path`, `node:crypto`)

    ## EXAMPLE — violation
    import { readFileSync } from 'node:fs'   // BANNED: Node.js built-in
    const secret = process.env.SECRET        // BANNED: process.env

    ## EXAMPLE — correct
    const secret = c.env.SECRET              // OK: Cloudflare Workers env binding

### 2d. Namespace Classification Check

- [ ] New namespace correctly classified as leaf or integration
- [ ] Leaf namespaces import only from own directory + npm deps (not other forge namespaces)
- [ ] Integration namespaces explicitly documented in [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) §2b

### 2e. Facade Boundary Check

- [ ] Consumers import from `@y-core/forge/{namespace}`, not from `hono`/`valibot`/`@remix-run` directly
- [ ] New exports added to correct namespace (not placed in wrong namespace)
- [ ] `timingSafeEqual`/crypto utilities remain `@internal` in `src/crypto/`

    ## EXAMPLE — violation
    // src/handlers/contact.ts
    import { valibot } from 'valibot'   // BANNED: bypass facade, import via forge/validation

    ## EXAMPLE — correct
    import { parseInput } from '@y-core/forge/validation'

---

## 3. Security Review Checklist

### 3a. No Hardcoded Secrets

- [ ] No API keys, tokens, hex secrets hardcoded in source
- [ ] Secrets come from `c.env` bindings or `Config`

    ## EXAMPLE — violation
    const CSRF_SECRET = 'abc123deadbeef'   // BANNED: hardcoded secret

    ## EXAMPLE — correct
    const key = await importCsrfKey(c.env.CSRF_SECRET)

### 3b. CSP and Security Headers

- [ ] `NONCE` used in `scriptSrc` for inline scripts (not `'unsafe-inline'`)
- [ ] `mergeSecurityHeaders` used for dev/prod split (not hardcoded hashes in prod)
- [ ] `getNonce(c)` used in templates, not a hardcoded nonce value

    ## EXAMPLE — violation
    scriptSrc: ["'unsafe-inline'"]   // BANNED: disables XSS protection

    ## EXAMPLE — correct
    scriptSrc: ['self', NONCE]

### 3c. CSRF and Form Security (`form` namespace)

- [ ] CSRF verification is in `@y-core/forge/form` (not `security` namespace)
- [ ] `csrfProtection` used on state-changing routes (`POST`/`PUT`/`DELETE`)
- [ ] `importCsrfKey` called with env-provided secret, not hardcoded

### 3d. Origin and Transport Guards

- [ ] `originGuard` or `verifyOrigin` used for webhooks/trusted-caller routes
- [ ] `isHxRequest` check on HTMX-only endpoints
- [ ] `requireFormContentType` on form `POST` routes

    ## EXAMPLE — HTMX endpoint missing guard
    app.post('/fragment', async (c) => {   // MISSING: isHxRequest guard
      return c.html(<SomeFragment />)
    })

    ## EXAMPLE — correct
    app.post('/fragment', async (c) => {
      if (!isHxRequest(c)) return c.text('Not Found', 404)
      return c.html(<SomeFragment />)
    })

---

## 4. Testing Checklist

### 4a. Co-Location and Coverage

- [ ] New source file has co-located `*.test.ts` in same directory
- [ ] Every exported function has at least one test case
- [ ] Error paths tested (not just happy path)

### 4b. HTML Entity Encoding in Assertions

- [ ] Test assertions use encoded entities: `&#39;` not `'`, `&amp;` not `&`
- [ ] Exact-match assertions (`toBe`/`toEqual`) used for deterministic output
- [ ] No substring matching (`toContain`) when exact match is possible

    ## EXAMPLE — violation
    expect(html).toContain("user's data")   // WRONG: unencoded entity, substring match

    ## EXAMPLE — correct
    expect(html).toBe('<p>user&#39;s data</p>')

### 4c. Security Test Completeness

- [ ] Security guards tested for both pass AND fail cases
- [ ] CSRF tests: valid token passes, missing/invalid → 403
- [ ] Rate limit tests: under limit passes, over limit → 429

    ## EXAMPLE — incomplete test
    it('accepts valid CSRF token', async () => { /* ... */ })
    // MISSING: test for invalid/missing token returning 403

---

## 5. Severity Calibration

### 5a. Critical — Block Merge

- Hardcoded secrets or credentials in source
- `security` namespace exports `timingSafeEqual` (breaks `@internal` contract)
- `export * from` in `mod.ts` (breaks barrel discipline)
- `../sibling/mod` import (circular dependency risk)
- Node.js API used in source file (breaks runtime-only constraint)
- Missing CSRF/auth guard on state-changing endpoint
- Unchecked error in security-critical code path

### 5b. Major — Should Fix Before Merge

- New export missing from `mod.ts`
- Security test missing fail case
- New namespace not classified in [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md)
- HTML entity encoding wrong in test assertions
- `bun run check` fails (any step)

### 5c. Minor — Consider Fixing

- Missing TSDoc on exported symbol
- Imperative loop where array method suffices
- Module-level constant not exported (if needed by tests)
- Non-keyword-dense section titles in new `.decisions/` docs

### 5d. Informational — Note Only

- Suggestions for future namespace splits
- Alternative API designs
- Performance optimizations without security impact

---

## 6. Verification Protocol

### 6a. Verify Before Reporting

1. Read the full file, not just the diff — surrounding code may contain guards
2. Check `biome.json` and `tsconfig.json` for project-specific rules before flagging style
3. Check `package.json` exports before claiming a symbol is "unexported"
4. Verify Web API availability in Workers before flagging as "unavailable"

### 6b. Common False-Positive Patterns

These appear suspicious but are intentional — verify context before filing a finding:

- `contextVar` used in forge source (it is internal and intentional)
- `crypto` utilities being `@internal` (they are intentionally not public)
- `validate-exports` script reading `package.json` (build tooling is exempt from Web-API-only)
- `sideEffects` entry in `package.json` for HTMX bundle (intentional bundler hint)

---

## 7. Valid Patterns (Do Not Flag)

| Pattern | Why it is valid |
|---|---|
| `import { v } from "@y-core/forge/validation"` in source | `validation/mod` is an exempt sibling |
| `import ... from "../crypto/..."` in forge source | `crypto` is an exempt internal module |
| `export const X = "..."` at module level | constants are not mutable state |
| `sideEffects: ["./src/ui/client/htmx.ts"]` in `package.json` | intentional htmx bundle |
| `!**/*.test.ts` in `package.json` files | intentional test exclusion from publish |
| `bun:test` imports in `*.test.ts` files | test-only context, stub provides types |
| Non-null assertion in test files | biome overrides allow it in test files |
