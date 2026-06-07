# r-test — Testing Excellence Rules

> Ruleset for `cc-test`. Read entirely before writing any test.

---

## Test Philosophy

- **Test at boundary, not implementation.** Assert what goes in and out. Never assert internal state callers cannot observe.
- **One test file per implementation file.** `foo.ts` → `foo.test.ts`, same directory.
- **Table-driven tests** (array of `{ input, expected }`) for any function with 3+ input variations.
- **Fakes over mocks.** Implement the interface manually as a `fake` object typed to the interface. Never use mock generation libraries (jest-mock, sinon, etc.) — they couple tests to implementation details.
- **No database tests.** Forge has no DB-backed repository layer. All tests are pure unit tests with Web API fakes.

---

## Test File Locations

Tests are **co-located with implementation** in the same directory. Never create a separate `__tests__/` or `test/` directory:

| Code under test | Test file location |
|---|---|
| `src/security/headers.ts` | `src/security/headers.test.ts` |
| `src/form/csrf.ts` | `src/form/csrf.test.ts` |
| `src/ui/core/button.tsx` | `src/ui/core/button.test.tsx` |
| `src/router/resolve.ts` | `src/router/resolve.test.ts` |
| `src/storage/kv/store.ts` | `src/storage/kv/store.test.ts` |

Tests for forge namespaces are maintained here — do not create tests that reach outside the namespace under test.

---

## Unit Tests of Exported Functions

Test the full observable contract: return value, `Result` shape, thrown errors, side-effect captures.

### Setup

```typescript
import { describe, expect, it } from "bun:test"
import { parseUrl } from "./url"

describe("parseUrl", () => {
  it("returns ok result for valid URL", () => {
    const r = parseUrl("https://example.com/path")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.hostname).toBe("example.com")
  })

  it("returns error result for invalid URL", () => {
    const r = parseUrl("not-a-url")
    expect(r.ok).toBe(false)
  })
})
```

### What to Assert

1. **Return value shape** — `r.ok`, `r.value`, `r.issues` (for `Result`/`ValidationResult`)
2. **Exact output** — string equality on rendered HTML, not substring matching
3. **Error cases** — every path that returns `ok: false` or throws has a dedicated test case
4. **Side effects via fakes** — capture arguments passed to fake dependencies (see §4c)

### HTML Assertions

HTML entities MUST be encoded in test strings:

```typescript
// correct
expect(html).toBe("<td>O&#39;Brien &amp; Associates</td>")  // apostrophe, ampersand
expect(html).toBe("<span>2 &lt; 3</span>")                   // less-than
```

**Never use substring matching when exact match is possible.** `toContain` hides entity encoding errors and false positives when surrounding HTML changes.

### Error Path Coverage (mandatory)

Every test file MUST include cases for:

- Function returns `ok: false` with expected error shape
- Invalid or malformed input → correct error message or `ValidationResult` with issues
- Missing required dependency (null binding) → throws expected error at factory time
- Boundary values (empty string, zero, maximum length)

---

## Fake Pattern

### Implement the Interface

A fake is a minimal in-test implementation typed to the required interface:

```typescript
const fakeKV: KVNamespace = {
  get:             async (_key)        => null,
  put:             async (_key, _val)  => {},
  delete:          async (_key)        => {},
  list:            async ()            => ({ keys: [], list_complete: true, cursor: "" }),
  getWithMetadata: async ()            => ({ value: null, metadata: null }),
}
```

TypeScript enforces that all interface members are present. If the interface gains a new method, the fake breaks at compile time.

### Capturing Arguments

```typescript
let capturedKey = ""
let capturedValue = ""

const fakeKV: KVNamespace = {
  put: async (key, value) => {
    capturedKey   = key
    capturedValue = value as string
  },
  // ...other members
}

await myFunction(fakeKV)

expect(capturedKey).toBe("session:abc123")
expect(capturedValue).toBe("user-data")
```

Use `let` captures at the top of the `it` block. Reset in `beforeEach` if the fake is shared across multiple cases.

### Why Fakes Over Mocks

| Concern | Fake | Mock library |
|---|---|---|
| API change detection | Compile error | Silent — test passes with stale signature |
| Readability | Explicit object literal | Chain of `.mockReturnValue(...)` calls |
| Coupling | To the interface contract | To call order, argument matchers, invocation counts |
| Dependencies | None | Requires mock library in devDependencies |

Mock libraries are not installed and must not be added.

---

## HTML Entity Rules

forge JSX escapes interpolated dynamic content. When asserting rendered HTML, use escaped forms:

| Character | Escaped form |
|---|---|
| `'` (apostrophe) | `&#39;` |
| `&` (ampersand) | `&amp;` |
| `<` (less-than) | `&lt;` |
| `>` (greater-than) | `&gt;` |
| `"` in attributes | `&#34;` or `&quot;` |

Static JSX string literals (not interpolated) are NOT escaped by forge — only interpolated values are. Know the difference before writing assertions.

When a test fails unexpectedly on entity encoding, print the raw string:

```typescript
const html = await render(<MyComponent name="O'Brien" />)
console.log(JSON.stringify(html))  // shows escaped characters unambiguously
```

Read the raw output first, then write the assertion to match it exactly.

---

## Security Test Requirements

Security-sensitive code requires **both** pass and fail test cases:

| Feature | Required positive case | Required negative case |
|---------|----------------------|----------------------|
| CSRF protection | Valid token → 200 | Missing or invalid token → 403 |
| Origin check | Same-origin → proceeds | Cross-origin → 403 |
| Rate limiting | Under limit → 200 | Over limit → 429 |
| Input validation | Valid input → ok result with values | Invalid input → ValidationResult with issues |
| `isHxRequest` guard | `HX-Request: true` → proceeds | Header absent → 403 |
| Auth middleware | Valid session → proceeds | Missing or expired session → 401 |

The negative case must assert the exact response status AND a meaningful response body — not just the status code:

```typescript
it("rejects missing CSRF token with 403", async () => {
  const res = await app.request("/contact", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "name=Alice&email=alice%40example.com",  // no csrf_token field
  })
  expect(res.status).toBe(403)
  const html = await res.text()
  expect(html).toBe("Forbidden")
})
```

Do not mock `makeSecurityHeaders`, `verifyCsrfToken`, or other security primitives. Test with real implementations against fake bindings.

---

## Coverage Requirements

- Every **exported function** has at least one test
- Every **error path** has a dedicated test case
- Every **`Result` failure branch** tested for correct shape
- **No test skips** without a comment explaining when the skip will be removed

---

## Running Tests

```bash
# Full suite (always run after any change)
bun test

# Tests under a specific namespace
bun test src/security/

# Watch mode (dev iteration only)
bun test --watch

# Full gate (required before declaring task complete)
bun run check
```

`bun run check` expands to: `tsgo` typecheck + `biome` lint + `bun test` + `validate-exports`. All four steps must pass with zero errors. Always run the full suite before declaring a task complete — not just the changed namespace.
