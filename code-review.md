# Forge Code Review — 2026-08-03

## Scope

Reviewed the full TypeScript source tree, public export map, runtime/tooling boundary, security
middleware, form and session handling, storage adapters, structured logging, SSR escaping, and
browser-controller lifecycle code. The review also applied the repository's Tier 2 detection
queries from [`.decisions/CODE_REVIEW.md`](.decisions/CODE_REVIEW.md).

The previously tracked review findings are already remediated in the current `v0.0.80` source.
They are intentionally not repeated here as open work.

## Findings

All four findings below were verified against the source and are now **resolved**. Each carries the
remediation that closed it; they are kept rather than deleted so the reasoning stays reviewable.

### `src/logging/kv-channel.ts:101` — probabilistic purge is detached from the Worker lifetime

Severity: Major — **Resolved**

`write` now `await`s `Promise.all([putPromise, purge(...).catch(() => {})])`, so a selected purge is
inside the promise `flush()` and `waitUntil()` track. The rejection stays swallowed deliberately:
`Logger.flush()` uses `Promise.all`, not `allSettled`, and `requestLogger` awaits it inside a
`finally`, so a propagating purge failure would discard a successful response. `LogChannel.write`
now carries a TSDoc contract stating that a returned promise must cover the maintenance work too.
Covered by `kv-channel.test.ts` → "write does not settle until a selected purge settles", which
parks the stub's deletes so an awaited purge is distinguishable from a detached one.

`write()` starts `purge(...)` with `void ...catch(...)`, but returns only the KV `put` promise.
Consequently `Logger.flush()` and `requestLogger`'s `executionCtx.waitUntil()` can observe the log
write as complete while the purge remains untracked. A Workers isolate may be suspended as soon as
the tracked work finishes, so the soft `maxLogs`/`highWater` cap is unreliable in production even
when the random purge branch is selected. The TTL eventually bounds retention, but it does not
enforce the documented soft cap and can leave substantially more KV keys (and storage/list cost)
than configured.

Return or await a promise that covers both `putPromise` and the best-effort purge. Preserve error
isolation by catching only the purge rejection, for example by returning a combined promise whose
purge branch resolves after logging/ignoring its failure. Add a test proving the channel write does
not settle until a selected purge settles.

### `src/ui/client/lazy.ts:35` — failed dynamic imports become unhandled rejections and cannot retry

Severity: Major — **Resolved**

`lazy` passes a rejection handler to `.then`, reports the error through a new optional `onError`,
and re-observes the element so the next intersection retries — bounded to `LAZY_MAX_ATTEMPTS` (3)
`load()` calls, because `observe()` fires immediately for an element already on screen and an
uncapped re-observe would spin. A `disposed` flag set by the disposer suppresses the re-observe for
a load still in flight at teardown. `onError` rides on the already-exported `LazyImportOptions`, so
no barrel change was needed. Covered by five new `lazy.test.ts` cases (rejection routing, retry,
the cap, recovery on retry, and dispose-during-load).

The observer disconnects before invoking `options.load()`, and the returned promise has only a
success handler. A chunk fetch/import failure therefore produces an unhandled rejection; the
element is no longer observed and can never retry. For optional UI this turns a transient network
failure into a permanently dead control and can also trigger application-level unhandled-rejection
telemetry.

Handle the rejection explicitly and define a retry policy. A minimal resilient implementation can
re-observe the element after failure (unless disposed) and optionally expose an `onError` callback.
Add a rejection-path test that verifies no unhandled rejection escapes and that the chosen retry or
terminal-error behavior occurs.

### `src/ui/client/turnstile.ts:105` — cleanup leaves script-wait timers active

Severity: Minor, raised in practice — `UI_CLIENT_RUNTIME.md` §2d ("The Disposer Contract") already
requires a disposer to clear a pending timer, so this was a written-invariant violation rather than
untidiness. **Resolved**

All three handles — the poll interval, its paired giving-up timeout, and the script-load fallback
timeout — are now tracked and cleared through one `clearTimers()`, following `transition.ts`'s
`clearPending()` idiom. `cleanup` sets `disposed` and clears the timers before detaching listeners;
`renderWidget()` and `showFallback()` return early when disposed, so a late script `load` or poll
hit cannot render into a detached container or reveal a fallback that has left the page. A second,
unreported leak is fixed with it: the poll's paired timeout stayed pending after a *successful*
poll and is now cleared in the success branch. Covered by two new `turnstile.browser.ts` lifecycle
cases (cleanup during an in-flight script, cleanup while polling an already-present script).

When a Turnstile script already exists but its API is not ready, `mountTurnstile()` creates a poll
interval and a timeout. For a newly inserted script it creates a fallback timeout. None of these
timer handles is retained by `cleanup()`. Removing an htmx-swapped widget therefore leaves closures
over its document, form, and container alive until the timeout expires; if the API appears during
that window, the detached widget may also be rendered after cleanup. The leak is bounded by
`TURNSTILE_SCRIPT_TIMEOUT_MS`, but repeated swaps can accumulate concurrent timers and stale work.

Track all active interval/timeout handles plus a disposed flag. Clear the handles during cleanup
and make load/error/poll callbacks no-op once disposed. Add lifecycle tests for cleanup while the
script is in flight and while waiting on an already-present script.

### `src/ui/client/lazy.ts:81` — concurrent stylesheet callers can resolve before the stylesheet loads

Severity: Minor — **Resolved**

`loadStylesheet()` treats an existing matching `<link>` as already loaded. If a second caller runs
after the first appends the link but before its `load`/`error` event, the second promise resolves
immediately. Its dependent code can execute without the stylesheet, producing a flash or incorrect
layout. An eventual load failure is only reported to the first caller.

Cache the in-flight promise per document and absolute stylesheet URL, or attach the second caller
to the existing link's `load` and `error` events unless a loaded marker/state is present. Ensure
failed entries are evicted so a later call can retry.

A `WeakMap<Document, Map<string, Promise<void>>>` now holds the in-flight promise, checked *before*
the `querySelector` duplicate check so a caller arriving mid-load joins the real `load`/`error`; the
duplicate check still runs second and still resolves immediately for a link this function did not
create. A failure evicts its entry (identity-checked, so a slow failure cannot evict a newer entry),
so a later call appends a fresh link. Keys are the `href` string as passed — normalizing a relative
against an absolute URL is out of scope. Module-level state in `ui/client/` is exempt from the
zero-global-state rule per `PRODUCTION_TS_RULES.md` §1e; keying on `Document` also satisfies §4a
without a reset export, since each test installs a fresh fake document. Covered by three new
`lazy.test.ts` cases (concurrent wait, concurrent rejection, eviction-then-retry).

## Security and leak assessment

No currently exploitable secret disclosure, injection, cross-tenant cache collision, SQL
injection, CSRF bypass, unsafe URL scheme, or unbounded strong-reference DOM leak was verified.
The security-critical paths reviewed are fail-closed. The bounded Turnstile timer retention noted
above was the one outstanding leak and is now closed.

The direct `valibot` facade scan was clean. The runtime Web-API scan found only Node imports in a
test-only source-analysis file, not shipped runtime code. The sibling-barrel scan found one test
import used for public-surface inspection; no production namespace edge was introduced.

## Verification

`bun run check` is green: all seven configured steps passed in the user's immediate rerun on
2026-08-03. An earlier delegated run experienced one asset-pipeline timeout followed by three
asset-test failures, but the failure did not reproduce and is therefore not listed as a current
finding.

All four findings were subsequently remediated, with tests and governing-doc corrections
(`UI_CLIENT_RUNTIME.md` §3b's three lazy-loading signatures were stale and are now accurate).
