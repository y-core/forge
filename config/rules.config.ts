import { UI_DESIGN_RULES } from "../src/ui/design/rules";
import { defineRules } from "../warden/src/rules/define";

export default defineRules([
  ...UI_DESIGN_RULES,
  {
    id: "forge-sql-tag-called-directly",
    statement:
      "Never call `sql` as a function or assemble a fragment around a name the caller sent, and map the choice onto a fixed set of literal fragments instead.",
    detectors: [{ kind: "lint", key: "forge/sql-tag-called-directly" }],
  },
  {
    id: "forge-sql-explicit-transaction",
    statement:
      "Never open or close a transaction with `BEGIN`, `COMMIT` or `ROLLBACK` in a runtime `sql` fragment, because `batch()` is the boundary.",
    detectors: [{ kind: "lint", key: "forge/sql-explicit-transaction" }],
  },
  {
    id: "forge-sql-delete-authorised",
    statement: "An application `DELETE` names who authorised it on the line before the `sql` fragment that runs it.",
    detectors: [{ kind: "lint", key: "forge/sql-delete-authorised" }],
  },
  {
    id: "forge-sql-in-loop",
    statement:
      "Never make a D1 call per item, and bind the items' keys as one `json_each` parameter or load them through `createRowLoader` instead.",
    detectors: [{ kind: "lint", key: "forge/sql-in-loop" }],
  },
  {
    id: "forge-type-import-external",
    statement: "Every exported interface and type alias is declared in the `types.ts` of its own directory.",
    detectors: [{ kind: "lint", key: "forge/type-import-external" }],
  },
  {
    id: "forge-type-import-separation",
    statement: "A type is imported with `import type` as its own statement, never as an inline `type` specifier inside a value import.",
    detectors: [{ kind: "lint", key: "forge/type-import-separation" }],
  },
  {
    id: "forge-data-slot-before-spread",
    statement: "Never write a literal `data-slot` before the forwarded `{...rest}` spread, which overrides it with the caller's token.",
    detectors: [{ kind: "lint", key: "forge/data-slot-before-spread" }],
  },
  {
    id: "forge-suppression-needs-reason",
    statement: "Every `oxlint-disable` directive names the rules it suppresses and states why after `--`.",
    detectors: [{ kind: "lint", key: "forge/suppression-needs-reason" }],
  },
  {
    id: "forge-test-cross-engine-tag",
    statement:
      'A top-level block whose assertions read what the engine computes carries `{ tag: "@cross-engine" }`, and the tag is written nowhere else.',
    detectors: [{ kind: "step", label: "validate-cross-engine-tags" }],
  },
  {
    id: "forge-ui-recipe-respelled",
    statement:
      "A component in `src/ui` takes a focus ring or disabled paint from the `@utility` recipe `forge-ui.css` publishes, never by spelling it out.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`focus-visible:ring-2|has-\[:focus-visible\]:ring|peer-focus-visible:ring|disabled:opacity-50|has-\[:disabled\]:opacity|has-\[select:disabled\]:opacity`,
        paths: ["src/ui"],
        exclude: ["*.test.*", "forge-ui.css", "src/ui/design/**"],
        level: "warn",
        triage:
          "One hit is legitimate: `Switch`'s `peer-focus-visible:ring-2` on the track, which reaches across a sibling that `&:has()` cannot; any other is a component re-spelling a recipe.",
      },
    ],
  },
  {
    id: "forge-valibot-facade",
    statement: "Import `v` from the `validation` facade, never `valibot` directly, in a test as in source.",
    detectors: [
      { kind: "lint", key: "eslint/no-restricted-imports" },
      {
        kind: "rg",
        pattern: String.raw`from "valibot"|from \x27valibot\x27`,
        paths: ["src/", "warden/src/"],
        exclude: ["src/validation/**", "**/*.mjs"],
        level: "warn",
        triage:
          "A check's fixture carries the specifier as a string literal for the code under test to find — `src/tooling/gate/` or `warden/src/` only, inside a quoted fixture rather than at module scope; any other hit is a breach.",
      },
    ],
  },
  {
    id: "forge-sibling-barrel-import",
    statement:
      "Import a sibling namespace's concrete source file, never its `mod.ts` barrel, outside the `validation` and `crypto/primitives` exemptions.",
    detectors: [
      { kind: "lint", key: "eslint/no-restricted-imports" },
      {
        kind: "rg",
        pattern: String.raw`from "\.\./(?!validation/mod|primitives/mod)[a-z-]+/mod"`,
        paths: ["src/", "warden/src/"],
        exclude: ["*.test.*"],
        pcre: true,
        level: "fail",
      },
    ],
  },
  {
    id: "forge-runtime-web-apis-only",
    statement: "Runtime source reaches neither `Bun` nor a `node:` module, outside the build-time trees and the node-only `testing` modules.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bBun\.|from "node:`,
        paths: ["src/"],
        exclude: [
          "src/tooling/**",
          "src/ui/assets/build/**",
          "src/testing/snapshot.ts",
          "src/testing/harness.ts",
          "**/*.test.ts",
          "**/*.test.tsx",
          "**/*.browser.ts",
          "**/*.md",
          "**/*.fixture.ts",
          "src/testing/d1/*.ts",
          "**/*.mjs",
        ],
        level: "fail",
      },
    ],
  },
  {
    id: "forge-client-timer-cleared",
    statement: "A browser controller clears every timer handle it starts in its disposer, and a poll's timer also when the poll succeeds.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`setTimeout\(|setInterval\(`,
        paths: ["src/ui/client/"],
        level: "warn",
        triage: "A hit is a defect only if the module's disposer does not clear the handle — read the disposer, not the call site.",
      },
    ],
  },
  {
    id: "forge-substring-markup",
    statement: "Never assert on rendered HTML with a substring match.",
    detectors: [
      { kind: "lint", key: "forge/exact-markup-assertion" },
      {
        kind: "rg",
        pattern: String.raw`toContain\(|toMatch\(|\.includes\(`,
        paths: ["src/", "warden/src/"],
        include: ["*.test.ts*"],
        level: "warn",
        triage: "Legitimate on non-HTML strings — an error message, a log line, a SQL fragment; a hit asserting on rendered markup is a defect.",
      },
    ],
  },
  {
    id: "forge-icon-prop-narrow",
    statement: "Type an icon prop with the glyph names the component renders, never as `ForgeIcon<string>`.",
    detectors: [{ kind: "rg", pattern: String.raw`\bicon\??:\s*ForgeIcon(<string>)?\s*[;,]`, paths: ["src/"], level: "fail" }],
  },
  {
    id: "forge-remix-headers-facade",
    statement: "Only the `http` namespace imports `@remix-run/headers`; every other module takes its header classes from `http`.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "forge-auth-passkey-user-verification",
    statement: 'A passkey ceremony forge runs asks for `userVerification: "required"`, never `preferred` or `discouraged`.',
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`userVerification:\s*"(preferred|discouraged)"`,
        paths: ["src/auth/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/auth/passkey/options.ts", 'authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },']],
          passes: [
            ["src/auth/passkey/options.ts", 'authenticatorSelection: { residentKey: "preferred", userVerification: "required" },'],
            ["src/auth/passkey/options.test.ts", 'ceremony({ userVerification: "discouraged" })'],
          ],
        },
      },
    ],
  },
  {
    id: "forge-auth-prf-by-output",
    statement: "Judge PRF support by a 32-byte result, never by `prf.enabled` or `getClientCapabilities()`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`prf\.enabled|getClientCapabilities\(`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/auth/client/prf.ts", "if (results.prf.enabled) return true;"],
            ["src/auth/client/prf.ts", "const capabilities = await PublicKeyCredential.getClientCapabilities();"],
          ],
          passes: [["src/auth/client/prf.test.ts", "expect(results.prf.enabled).toBe(true);"]],
        },
      },
    ],
  },
  {
    id: "forge-auth-recovery-codes-no-file",
    statement: "Never hand a recovery-code set over as a file, whether a download endpoint, a `data:` link or a blob the page builds.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`Content-Disposition|createObjectURL|\bdownload\b|data:text/`,
        paths: ["src/auth/web/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/auth/web/views/recovery-codes.tsx", '<a download="codes.txt" href={href}>'],
            ["src/auth/web/actions.ts", 'headers.set("Content-Disposition", "attachment");'],
          ],
          passes: [["src/auth/web/views/recovery-codes.tsx", '<pre>{codes.join("\\n")}</pre>']],
        },
      },
    ],
  },
  {
    id: "forge-no-cookie-header-log",
    statement: "Never log a request's `Cookie` header.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(log|logger|console)\.\w+\(.*[Cc]ookie`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "A message naming a cookie without carrying the header's value — a missing or refused session cookie — is legitimate; one passing the `Cookie` header, or a value read from it, is the defect.",
        examples: {
          hits: [["src/logging/request-logger.ts", 'logger.info("request", { cookie: request.headers.get("Cookie") });']],
          passes: [["src/logging/request-logger.ts", 'logger.info("request", { path });']],
        },
      },
    ],
  },
  {
    id: "forge-db-backup-tooling-only",
    statement: "The D1 pipeline — migrate, compose, seed, backup and restore — lives in `tooling/db`, and no Worker-reachable module imports it.",
    detectors: [{ kind: "step", label: "validate-import-boundary" }],
  },
  {
    id: "forge-db-migration-composed",
    statement: "Every migration file is one `forge db migrate compose` wrote, never one written or edited by hand.",
    detectors: [{ kind: "step", label: "db:lint" }],
  },
  {
    id: "forge-db-no-autoincrement",
    statement: "No table keys its `id` with `AUTOINCREMENT`, forge's own migration history table included.",
    detectors: [
      { kind: "step", label: "db:lint" },
      {
        kind: "rg",
        pattern: String.raw`\bAUTOINCREMENT\b`,
        paths: ["src/"],
        include: ["*.sql", "companions.ts"],
        ignoreCase: true,
        level: "fail",
        examples: {
          hits: [
            ["src/auth/schema.sql", "  id INTEGER PRIMARY KEY AUTOINCREMENT,"],
            ["src/tooling/db/migrate/companions.ts", "  id INTEGER PRIMARY KEY autoincrement,"],
          ],
          passes: [["src/tooling/db/migrate/lint.ts", 'const RULE = "AUTOINCREMENT";']],
        },
      },
    ],
  },
  {
    id: "forge-sql-fragment-only",
    statement: "Build every D1 query as a `sql` fragment, never by concatenating strings.",
    detectors: [
      { kind: "step", label: "typecheck" },
      { kind: "lint", key: "forge/sql-tag-called-directly" },
    ],
  },
  {
    id: "forge-result-by-helpers",
    statement: "Build a `Result` with `ok()` or `err()`, never as an object literal.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\{\s*ok:\s*(true|false)\s*,`,
        paths: ["src/", "warden/src/"],
        exclude: ["src/result/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "A shape of its own that discriminates on `ok` — an `{ ok, response }` or `{ ok, steps }` union — is not a `Result`, and a `Result` carrying a field the helpers cannot, as `D1Client`'s `meta`, is legitimate; a bare `{ ok, data }` or `{ ok, error }` literal is the defect.",
        examples: {
          hits: [["src/storage/kv/store.ts", "return { ok: true, data };"]],
          passes: [["src/result/result.ts", "return { ok: true, data };"]],
        },
      },
    ],
  },
  {
    id: "forge-validation-issue-message",
    statement:
      "Never show a validation issue's `message` outside `validation` and build-time tooling; render the issue through `describeValidationIssue`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`issue\.message|issues\[\d+\]\.message`,
        paths: ["src/", "warden/src/"],
        exclude: ["src/validation/**", "src/tooling/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/app/action.ts", "const text = issues[0].message;"]],
          passes: [
            ["src/validation/format-issues.ts", "return issue.message;"],
            ["src/tooling/cf/config/parse.ts", "return issue.message;"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-vouched-message-env-key",
    statement: "A `safeCheck` message names the requirement, never an env key.",
    detectors: [{ kind: "lint", key: "forge/vouched-message-env-key" }],
  },
  {
    id: "forge-turnstile-secret-server-only",
    statement: "`secretKey` is server-side only and never appears in a browser module.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`secretKey|TURNSTILE_SECRET`,
        paths: ["src/"],
        include: ["src/**/client/**"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/client/turnstile.ts", "const secretKey = root.dataset.secret;"]],
          passes: [["src/form/turnstile.ts", 'body.set("secret", options.secretKey);']],
        },
      },
    ],
  },
  {
    id: "forge-csrf-config-via-store",
    statement:
      "Parse an environment-sourced CSRF secret through `CsrfConfigSchema` in the config store, never by handing a raw `env` string to `parseKeyRingSecrets`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`parseKeyRingSecrets\(\s*(c\.)?env\b`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/app/csrf.ts", "const secrets = parseKeyRingSecrets(c.env.CSRF_SECRET);"],
            ["src/app/csrf.ts", "const secrets = parseKeyRingSecrets(env.CSRF_SECRET);"],
          ],
          passes: [["src/app/csrf.ts", "const secrets = parseKeyRingSecrets(config.csrf.secret);"]],
        },
      },
    ],
  },
  {
    id: "forge-router-matcher-error-import",
    statement: "Outside `router` and `app`, import `MatcherResourceError` and its details from `router`, never from route-pattern.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`MatcherResourceError.*from "@remix-run/route-pattern`,
        paths: ["src/"],
        exclude: ["src/router/**", "src/app/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/security/refusal.ts", 'import { MatcherResourceError } from "@remix-run/route-pattern/match";']],
          passes: [
            ["src/app/forge-app.ts", 'import { MatcherResourceError } from "@remix-run/route-pattern/match";'],
            ["src/router/mod.ts", 'export { MatcherResourceError } from "@remix-run/route-pattern/match";'],
          ],
        },
      },
    ],
  },
  {
    id: "forge-form-no-session-import",
    statement: '`form` never imports `session`, so `app` resolves a CSRF policy\'s `subject: "session"`.',
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "forge-csrf-context-get-optional",
    statement: "Read `csrfFieldCtx` and `csrfHeaderCtx` with `.getOptional`, never `.get`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`csrf(Field|Header)Ctx\.get\(`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/app/action.ts", "const field = csrfFieldCtx.get(c);"]],
          passes: [
            ["src/app/action.ts", "const field = csrfFieldCtx.getOptional(c);"],
            ["src/form/csrf.ts", "const mint = csrfMinterCtx.get(c);"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-view-no-io",
    statement: "A view performs no I/O, and every value it renders comes from the loader.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bfetch\(|\.prepare\(|\.env\.\w+\.(get|put|list|delete)\(`,
        paths: ["src/auth/web/views/", "src/logging/viewer/components.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/auth/web/views/admin-users.tsx", 'const rows = await c.env.DB.prepare("SELECT 1").all();'],
            ["src/logging/viewer/components.tsx", "const page = await fetch(url);"],
          ],
          passes: [["src/auth/web/loaders.ts", "const page = await fetch(url);"]],
        },
      },
    ],
  },
  {
    id: "forge-context-typed-accessor",
    statement: "Read and write a context slot through its typed `contextVar` accessor, never by a raw string key.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bc\.(get|set)\(["'\x60]`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          'A `c` that is not a request context is legitimate — a key-ring resolver\'s `c.get("SECRET")` reads a binding by name; a context slot read or written by a string key is the defect.',
        examples: { hits: [["src/app/page.ts", 'const user = c.get("user");']], passes: [["src/app/page.ts", "const user = userCtx.get(c);"]] },
      },
    ],
  },
  {
    id: "forge-dev-csp-behind-relax",
    statement:
      "A dev-only CSP source, the live-reload hash among them, is layered only from the app's `#relax` dev module and never reaches the production policy.",
    detectors: [{ kind: "step", label: "validate-dev-boundary" }],
  },
  {
    id: "forge-safe-url-renderer-only",
    statement: "A JSX view never calls `safeUrl` or `escapeAttribute`, because the renderer already applies both.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(safeUrl|escapeAttribute)\(`,
        paths: ["src/"],
        include: ["*.tsx"],
        exclude: ["src/html/**", "src/render/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/auth/web/views/verify.tsx", "<a href={safeUrl(next)}>Continue</a>"]],
          passes: [
            ["src/app/error-page.ts", 'html`<a href="${safeUrl(home)}">`'],
            ["src/render/jsx/attributes.tsx", "return safeUrl(value);"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-csp-first-party-fonts",
    statement: "Forge's `style-src` and `font-src` defaults name no third-party origin.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`(styleSrc|fontSrc|style-src|font-src)\b.*https?://`,
        paths: ["src/security/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/security/headers.ts", '  fontSrc: ["\'self\'", "https://fonts.gstatic.com"],']],
          passes: [["src/security/headers.ts", "  fontSrc: [\"'self'\"],"]],
        },
      },
    ],
  },
  {
    id: "forge-cors-per-route",
    statement: "Mount `cors` on the routes consumed cross-origin, never on every route.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\.use\(\s*(["'\x60]/?\*["'\x60]\s*,\s*)?(createCors|cors)\(`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/app/forge-app.ts", "app.use(cors({ origins }));"],
            ["src/app/forge-app.ts", 'app.use("*", cors(options));'],
          ],
          passes: [["src/app/forge-app.ts", 'app.use("/api/*", cors(options));']],
        },
      },
    ],
  },
  {
    id: "forge-rate-limit-window-generated",
    statement: "Take a rate limit's window from the generated `RATELIMITS` constant, never from a second `{ limit, period }` declaration.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\{\s*limit:\s*\d+,\s*period:`,
        paths: ["src/"],
        exclude: ["src/testing/**", "*.fixture.ts", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/app/middleware-chain.ts", "rateLimits: { LOGIN: { limit: 5, period: 60 } },"]],
          passes: [["src/auth/web/web.fixture.ts", "export const FAKE_RATE_LIMITS = { LIMITER: { limit: 10, period: 60 } } as const;"]],
        },
      },
    ],
  },
  {
    id: "forge-no-without-rowid",
    statement: "Never declare a UUID-keyed table `WITHOUT ROWID`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`WITHOUT\s+ROWID`,
        paths: ["src/"],
        include: ["*.sql"],
        ignoreCase: true,
        level: "fail",
        examples: {
          hits: [["src/auth/schema.sql", ") STRICT, WITHOUT ROWID;"]],
          passes: [["src/tooling/db/schema/introspect.ts", "withoutRowid: /\\bWITHOUT ROWID\\b/.test(parts.options),"]],
        },
      },
    ],
  },
  {
    id: "forge-kv-codec-explicit",
    statement: "Pass `codec` to every `createKVStore` call rather than leaning on its `jsonCodec()` fallback.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`createKVStore\(\s*[\w.]+\s*\)|createKVStore\([^)]*\{(?![^}]*\bcodec\b)[^}]*\}\s*\)`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        pcre: true,
        level: "fail",
        examples: {
          hits: [
            ["src/logging/kv-channel.ts", "const store = createKVStore(env.LOGS);"],
            ["src/logging/kv-channel.ts", 'const store = createKVStore(env.LOGS, { prefix: "logs" });'],
          ],
          passes: [["src/logging/kv-channel.ts", 'const store = createKVStore(env.LOGS, { prefix: "logs", codec: textCodec() });']],
        },
      },
    ],
  },
  {
    id: "forge-secret-from-binding",
    statement: "Source every secret from a secret binding, never from a literal in source.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`(importKeyRing|importAuthKeyRing|parseKeyRingSecrets|parseWebhookSecrets)\(\s*\[?\s*["'\x60]|secretKey:\s*["'\x60]|[Ss]ecret\w*["']?\s*[:=]\s*["'\x60][0-9a-fA-F]{32,}|["'\x60]whsec_[A-Za-z0-9+/=]{16,}`,
        paths: ["src/"],
        exclude: ["src/testing/**", "*.fixture.ts", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/app/keys.ts", 'const ring = await importKeyRing(["3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370"]);'],
            ["src/app/keys.ts", 'const keys = { siteKey: "1x00000000000000000000AA", secretKey: "1x0000000000000000000000000000000AA" };'],
            ["src/app/keys.ts", 'const sessionSecret = "3e8f0241998536b82050a9b2cdb21c47";'],
            ["src/app/keys.ts", 'const secrets = ["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"];'],
          ],
          passes: [
            ["src/app/keys.ts", "const ring = await importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET));"],
            [
              "src/auth/web/web.fixture.ts",
              'export const fakeWebRing = await importKeyRing(["3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370"]);',
            ],
          ],
        },
      },
    ],
  },
  {
    id: "forge-storage-cast-in-adapter",
    statement: "Cast a binding to a platform type only inside a storage adapter, never in a resolver or a consumer.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`as unknown as (R2Bucket|KVNamespace|D1Database)\b`,
        paths: ["src/"],
        exclude: ["src/testing/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "A cast inside `r2Backend`, `createKVStore` or `createD1Client` that a platform brand genuinely forces is legitimate; one in a resolver or a consumer is the defect.",
        examples: {
          hits: [["src/storage/db/resolve.ts", "const db = c.env.DB as unknown as D1Database;"]],
          passes: [["src/testing/fakes.ts", "return impl as unknown as KVNamespace;"]],
        },
      },
    ],
  },
  {
    id: "forge-log-viewer-access",
    statement: "Every log viewer mount passes `access`, and a public one opts out explicitly.",
    detectors: [{ kind: "step", label: "typecheck" }],
  },
  {
    id: "forge-controller-actions-match-routes",
    statement: "A controller's `actions` keys are exactly its routes' names, each action built for its route's params.",
    detectors: [{ kind: "step", label: "typecheck" }],
  },
  {
    id: "forge-d1-branch-on-kind",
    statement: "Branch on a `D1Failure`'s `kind`, never on its message text.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\.message\.(includes|startsWith|endsWith|match)\(`,
        paths: ["src/"],
        exclude: ["src/tooling/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "`classifyD1Error` is the one place that reads D1's message text, turning it into a `kind`; a hit on a thrown error that carries no kind is read against that, and one on a kinded failure is the defect.",
        examples: {
          hits: [["src/auth/stores/users.ts", 'if (failure.message.includes("UNIQUE")) return err("taken");']],
          passes: [
            ["src/auth/stores/users.ts", 'if (failure.kind === "constraint") return err("taken");'],
            ["src/tooling/release/git.ts", 'if (error.message.startsWith("fatal")) return undefined;'],
          ],
        },
      },
    ],
  },
  {
    id: "forge-build-time-not-worker-reachable",
    statement: "No Worker-executed module imports a build-time module, whether under `src/tooling/` or `src/ui/assets/build/`.",
    detectors: [{ kind: "step", label: "validate-import-boundary" }],
  },
  {
    id: "forge-client-not-worker-reachable",
    statement: "No Worker-executed module imports `ui/client`.",
    detectors: [{ kind: "step", label: "validate-ssr-boundary" }],
  },
  {
    id: "forge-gate-no-build-step",
    statement: "No step of `bun run verify` builds the library, which is always consumed as raw TypeScript.",
    detectors: [{ kind: "step", label: "validate-no-build" }],
  },
  {
    id: "forge-peer-file-resolved",
    statement: "Reach a file a peer package ships through `import.meta.resolve`, never by a `node_modules/` path.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`node_modules/[@\w]`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs", "*.fixture.ts"],
        level: "warn",
        triage:
          "A path written into a consumer's own config file, which the consumer's tool resolves from the project root — `OXLINT_BASE` and `TSCONFIG_BASE` in `config-files.ts` — is legitimate; a path forge itself reads a peer's file through is the defect.",
        examples: {
          hits: [["src/tooling/assets/font-build.ts", 'const wasm = "node_modules/harfbuzzjs/dist/hb.wasm";']],
          passes: [["src/tooling/gate/command.ts", "const bin = `${cwd}/node_modules/.bin`;"]],
        },
      },
    ],
  },
  {
    id: "forge-css-source-coverage",
    statement: "Every `src/ui/` directory whose files declare a utility class is scanned by `forge.css` or registered as class-free.",
    detectors: [{ kind: "step", label: "validate-css-sources" }],
  },
  {
    id: "forge-facade-no-namespace-reexport",
    statement: "A facade barrel never re-exports the whole namespace of the package it wraps.",
    detectors: [{ kind: "step", label: "validate-exports" }],
  },
  {
    id: "forge-types-file-declares-only",
    statement: "A `types.ts` exports declarations only, never a callable.",
    detectors: [{ kind: "step", label: "validate-co-location" }],
  },
  {
    id: "forge-files-array-by-class",
    statement: "The `files` array negates suffix classes and whole trees, never a single file.",
    detectors: [{ kind: "step", label: "validate-packaging" }],
  },
  {
    id: "forge-test-suffix-one-list",
    statement: "A check that must skip a test file asks `isTestSource` rather than spelling the test suffixes again.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\.(test|browser|fixture)\\?\.tsx?`,
        paths: ["src/tooling/gate/checks/", "warden/src/checks/"],
        exclude: ["src/tooling/gate/checks/source-scan.ts", "*.test.*", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "A check that collects the specs it runs, as `cross-engine-tags` collects `*.browser.ts`, one naming the test a source should have, as `co-location` does, and a message or comment naming a suffix are legitimate; a skip predicate spelling the suffixes is the defect.",
        examples: {
          hits: [
            ["src/tooling/gate/checks/modern-css.ts", 'const skip = (name: string) => name.endsWith(".test.ts");'],
            ["src/tooling/gate/checks/modern-css.ts", "const skip = (name: string) => /\\.test\\.tsx?$/.test(name);"],
          ],
          passes: [["src/tooling/gate/checks/source-scan.ts", 'const TEST_SUFFIXES = [".test.ts", ".test.tsx"];']],
        },
      },
    ],
  },
  {
    id: "forge-css-directive-reason",
    statement: "A stylesheet directive names its rule and gives a reason that reads on its own.",
    detectors: [{ kind: "step", label: "validate-comment-budget" }],
  },
  {
    id: "forge-crypto-primitives-sealed",
    statement: "`crypto/primitives` never gets an export subpath, so nothing outside forge imports it.",
    detectors: [{ kind: "step", label: "validate-exports" }],
  },
  {
    id: "forge-published-no-oxlint-import",
    statement: "A published module never imports `oxlint`, not even for its types.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bfrom\s+["']oxlint\b|\bimport\(\s*["']oxlint\b`,
        paths: ["src/", "warden/src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/tooling/lint/types.ts", 'import type { Plugin } from "oxlint";']],
          passes: [["src/tooling/lint/types.ts", 'import type { AstNode } from "./types.ts";']],
        },
      },
    ],
  },
  {
    id: "forge-type-edge-declared",
    statement: "A type-only import across namespaces is declared as an edge of kind `type`.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "forge-auth-no-web-import",
    statement: "`auth` never imports `auth/web`.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "forge-relax-dev-module",
    statement:
      "A relaxation production must not hold lives in a dev module a build condition selects, never behind a boolean on a production option.",
    detectors: [{ kind: "step", label: "validate-dev-boundary" }],
  },
  {
    id: "forge-child-namespace-edge",
    statement: "A namespace reaches a child namespace through a declared edge, and the two never import each other at value.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "forge-http-no-renderer-import",
    statement: "`http` never imports a renderer under `render/`.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "forge-component-one-props",
    statement: "A component takes one props object and never a second positional argument.",
    detectors: [{ kind: "test", path: "src/component-arity.test.ts" }],
  },
  {
    id: "forge-rule-entry-fields",
    statement: "A register entry declares its id, its statement and its detectors, and nothing else.",
    detectors: [
      { kind: "step", label: "validate-rules" },
      { kind: "step", label: "typecheck" },
    ],
  },
  {
    id: "forge-worker-no-node-globals",
    statement: "Worker source names no global `Bun`, `Buffer` or `process`, and imports neither `node:process` nor `node:buffer`.",
    detectors: [
      { kind: "lint", key: "eslint/no-restricted-globals" },
      { kind: "lint", key: "eslint/no-restricted-imports" },
    ],
  },
  {
    id: "forge-release-no-remote-url",
    statement: "Changelog promotion takes the repository URL from `package.json`, never from `git remote get-url`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`get-url`,
        paths: ["src/tooling/release/", "src/tooling/gate/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/tooling/release/git.ts", 'const url = git(["remote", "get-url", "origin"]);']],
          passes: [["src/tooling/release/git.ts", "const url = pkg.repository.url;"]],
        },
      },
    ],
  },
  {
    id: "forge-check-ok-derived",
    statement: "A check takes its `ok` from `checkResult`, never from a literal.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bok:\s*(true|false)\b`,
        paths: ["src/tooling/gate/checks/", "warden/src/checks/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/tooling/gate/checks/css-tokens.ts", "return { ok: false, findings, summary };"]],
          passes: [["src/tooling/gate/checks/css-tokens.ts", "return checkResult(findings, summary);"]],
        },
      },
    ],
  },
  {
    id: "forge-bundle-no-extensionless-shadow",
    statement: "No committed `.mjs`, `.js` or `.cjs` file sits where an extensionless relative import in `src/` resolves.",
    detectors: [{ kind: "step", label: "validate-bundle-shadows" }],
  },
  {
    id: "forge-types-artifact-same-shape",
    statement: "The types-only assets module has the built module's exports, group consts and union members, differing only in values.",
    detectors: [{ kind: "test", path: "src/tooling/assets/pipeline.test.ts" }],
  },
  {
    id: "forge-no-generated-assets-import",
    statement: "Forge's own UI source never imports a consumer's generated assets module.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["'](@assets|#assets)\b|\.forge/assets`,
        paths: ["src/ui/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/icon.tsx", 'import { icons } from "@assets";']],
          passes: [["src/ui/core/icon.tsx", 'import type { ForgeUiIconName } from "../assets/glyphs";']],
        },
      },
    ],
  },
  {
    id: "forge-sw-record-beside-module",
    statement: "The service-worker build record is written beside the generated module, never inside it.",
    detectors: [{ kind: "test", path: "src/tooling/gate/checks/service-worker.test.ts" }],
  },
  {
    id: "forge-no-bun-types",
    statement: "Neither `bun-types` nor `@types/bun` is installed or referenced from a `tsconfig.json` or `package.json`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`["']bun-types["']|["']@types/bun["']`,
        paths: ["."],
        include: ["package.json", "tsconfig*.json"],
        level: "fail",
        examples: {
          hits: [
            ["package.json", '"devDependencies": { "bun-types": "1.1.0" },'],
            ["tsconfig.json", '"types": ["@types/bun"],'],
          ],
          passes: [["tsconfig.json", '"types": [],']],
        },
      },
    ],
  },
  {
    id: "forge-no-dom-shim",
    statement: "`bun test` and the browser set never share a process, and no DOM shim is registered for either.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`happy-dom|jsdom|linkedom|global-registrator`,
        paths: ["."],
        include: ["package.json", "bunfig.toml"],
        level: "fail",
        examples: {
          hits: [
            ["bunfig.toml", 'preload = ["@happy-dom/global-registrator"]'],
            ["package.json", '"devDependencies": { "jsdom": "24.0.0" },'],
          ],
          passes: [["bunfig.toml", 'preload = ["./src/testing/preload.ts"]']],
        },
      },
    ],
  },
  {
    id: "forge-ua-pseudo-from-pixels",
    statement: "A vendor UA pseudo-element is asserted from rendered pixels, never from `getComputedStyle`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`getComputedStyle\([^)]*["']::-(webkit|moz)-`,
        paths: ["src/", "tests/"],
        include: ["*.browser.ts", "*.browser.tsx"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/slider.browser.ts", 'const track = getComputedStyle(el, "::-webkit-slider-runnable-track");']],
          passes: [["src/ui/core/dialog.browser.ts", 'const backdrop = getComputedStyle(el, "::backdrop");']],
        },
      },
    ],
  },
  {
    id: "forge-workerd-binding-structural",
    statement: "A workerd spec types a binding with forge's structural `D1Database` or `R2Bucket`, never a Workers global.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`@cloudflare/workers-types`,
        paths: ["tests/", "src/testing/"],
        exclude: ["*.md"],
        level: "fail",
        examples: {
          hits: [["tests/workerd/d1.ts", '/// <reference types="@cloudflare/workers-types" />']],
          passes: [["tests/workerd/d1.ts", 'import type { D1Database } from "../../src/storage/db/types";']],
        },
      },
    ],
  },
  {
    id: "forge-testing-fake-not-mocked",
    statement: "A test never mocks or spies on a `testing` fake.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(spyOn|mock)\(\s*fake[A-Z]\w*|mock\.module\(\s*["'][^"']*testing/`,
        paths: ["src/", "tests/", "warden/src/"],
        include: ["*.test.ts", "*.test.tsx"],
        exclude: ["warden/src/rules/check.test.ts"],
        level: "fail",
        examples: {
          hits: [
            ["src/storage/kv/store.test.ts", 'spyOn(fakeKV(), "put");'],
            ["src/storage/kv/store.test.ts", 'mock.module("../../testing/fakes", () => ({}));'],
          ],
          passes: [["src/tooling/assets/icons.test.ts", 'await mock.module("sharp", () => ({ default: stub }));']],
        },
      },
    ],
  },
  {
    id: "forge-testing-d1-shared-types",
    statement: "`d1/bun.ts` and `d1/migrations.ts` take their shared types from `d1/types.ts`, never from `d1/mod.ts`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["']\./mod(\.ts)?["']`,
        paths: ["src/testing/d1/"],
        include: ["bun.ts", "migrations.ts"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/testing/d1/bun.ts", 'import type { TestD1 } from "./mod";']],
          passes: [["src/testing/d1/bun.ts", 'import type { TestD1 } from "./types";']],
        },
      },
    ],
  },
  {
    id: "forge-theme-scheme-no-shape",
    statement: "A colour scheme file declares no shape token.",
    detectors: [{ kind: "test", path: "src/ui/assets/css/shape-tokens.test.ts" }],
  },
  {
    id: "forge-theme-contract-leaf",
    statement: "`ui/contracts/theme` is a leaf that publishes the theme's type contract and its colour arithmetic, never a component.",
    detectors: [
      { kind: "step", label: "validate-namespace-graph" },
      {
        kind: "rg",
        pattern: String.raw`\S`,
        paths: ["src/ui/contracts/theme/"],
        include: ["*.tsx"],
        exclude: ["*.test.*", "*.browser.tsx"],
        level: "fail",
        examples: {
          hits: [["src/ui/contracts/theme/swatch.tsx", "export const Swatch = () => <div />;"]],
          passes: [["src/ui/contracts/theme/color.ts", "export const mix = (a: number) => a;"]],
        },
      },
    ],
  },
  {
    id: "forge-contrast-refuses-empty",
    statement: "The contrast step fails on an empty pair list rather than passing it.",
    detectors: [{ kind: "step", label: "validate-contrast" }],
  },
  {
    id: "forge-state-attr-has-producer",
    statement: "Every name `STATE_ATTRS` declares has a producer in `src/ui/`.",
    detectors: [{ kind: "test", path: "src/ui/contracts/state-attrs.test.ts" }],
  },
  {
    id: "forge-state-presence-empty",
    statement: "A boolean state attribute is emitted present and empty, never with the value `true`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bdata-[a-z-]+(=|["']?\s*:\s*)["']true["']`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.browser.tsx", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/ui/core/tabs.tsx", '<button data-selected="true">'],
            ["src/ui/core/tabs.tsx", 'const attrs = { "data-busy": "true" };'],
          ],
          passes: [["src/ui/core/tabs.tsx", '<button aria-selected="true" data-selected="">']],
        },
      },
    ],
  },
  {
    id: "forge-island-state-attr",
    statement: "A serialized island payload is written to `data-island-state`, never to `data-state`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`data-state["']?\s*[:=]\s*\{?\s*JSON\.stringify|hydrateState\([^)]*(dataset\.state\b|["']data-state["'])`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [
            ["src/ui/server/resumable.tsx", "<div data-state={JSON.stringify(state)}>"],
            ["src/ui/client/resume.ts", "const signals = hydrateState(root.dataset.state);"],
          ],
          passes: [["src/ui/client/resume.ts", "const signals = hydrateState(root.dataset[ISLAND_STATE_KEY]);"]],
        },
      },
    ],
  },
  {
    id: "forge-attr-vocabulary-via-helper",
    statement: "A component emits a state or presentational attribute through its declaration's helper, never as a hand-written literal.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bdata-(selected|pressed|checked|disabled|invalid|busy|tone|appearance|size)(=|["']\s*:)`,
        paths: ["src/"],
        include: ["*.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.browser.tsx", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "An option a third-party widget reads is not forge's vocabulary — `Turnstile`'s `data-size` is Cloudflare's; a forge state or presentation hook spelled by hand is the defect.",
        examples: {
          hits: [["src/ui/core/badge.tsx", '<span data-tone="primary">']],
          passes: [["src/ui/core/badge.tsx", "<span {...presentationAttrs({ tone })}>"]],
        },
      },
    ],
  },
  {
    id: "forge-attr-table-no-dynamic-key",
    statement: "`STATE_ATTRS` and `PRESENTATION_ATTRS` are never indexed by a dynamic key outside the modules declaring them.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(STATE_ATTRS|PRESENTATION_ATTRS)\[`,
        paths: ["src/"],
        exclude: ["src/ui/contracts/state-attrs.ts", "src/ui/contracts/vocabulary.ts", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/client/bind.ts", "const name = STATE_ATTRS[key];"]],
          passes: [
            ["src/ui/client/tooltip.ts", 'content.setAttribute(STATE_ATTRS.instant, "");'],
            ["src/ui/contracts/state-attrs.ts", "const name = STATE_ATTRS[key];"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-state-recipe-descendant",
    statement: "Every state recipe matches a descendant carrying its state as well as its own element.",
    detectors: [{ kind: "test", path: "src/tooling/gate/checks/state-recipes.test.ts" }],
  },
  {
    id: "forge-state-recipe-slot-keyed",
    statement: "A state recipe is keyed into a conflict slot of its own, so it contends with no base-scope utility.",
    detectors: [{ kind: "step", label: "validate-class-groups" }],
  },
  {
    id: "forge-state-recipe-in-base-literal",
    statement: "A state recipe travels inside the base class literal, never as a `cn` argument of its own.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bcn\(.*,\s*["'\x60]state-[a-z]+["'\x60]`,
        paths: ["src/ui/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "A state recipe given its own argument is legitimate only where a reason at the site says why the base literal cannot carry it; `NumberField`'s input passes `state-invalid` with none, and is the known defect.",
        examples: {
          hits: [["src/ui/core/input.tsx", 'class={cn("field-chrome", "state-invalid", cls)}']],
          passes: [["src/ui/core/input.tsx", 'class={cn("state-invalid field-chrome", "cursor-pointer", cls)}']],
        },
      },
    ],
  },
  {
    id: "forge-static-class-const",
    statement: "A class string that never varies is a module-scope `const`, never a `cn` call at render.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`class(Name)?=\{cn\(\s*("[^"]*"\s*,?\s*)+\)\}`,
        paths: ["src/"],
        include: ["*.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.browser.tsx", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/card.tsx", '<div class={cn("p-4", "flex")} />']],
          passes: [["src/ui/core/card.tsx", "<div class={cn(CARD, cls)} />"]],
        },
      },
    ],
  },
  {
    id: "forge-cva-class-slot",
    statement: "A `cva` resolver takes the caller's class in its own `class` slot, never wrapped in a second `cn`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bcn\(\s*\w+Variants\(`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/button.tsx", "class={cn(buttonVariants({ tone }), cls)}"]],
          passes: [["src/ui/core/button.tsx", "class={buttonVariants({ tone, class: cls })}"]],
        },
      },
    ],
  },
  {
    id: "forge-caller-class-last",
    statement: "The caller's class is the last argument of every `cn` call that takes one.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bcn\([^;]*\b(cls|className)\b\s*,`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: { hits: [["src/ui/core/card.tsx", 'class={cn(cls, "p-4")}']], passes: [["src/ui/core/card.tsx", 'class={cn("p-4", cls)}']] },
      },
    ],
  },
  {
    id: "forge-theme-dark-one-site",
    statement: "A scheme file declares each role step exactly once, and no forge stylesheet declares a custom property under `.dark`.",
    detectors: [{ kind: "step", label: "validate-contrast" }],
  },
  {
    id: "forge-css-token-reserved-root",
    statement: "A font-size token is named `--text-size-` and a font face `--font-face-`, never a bare `--text-` or `--font-` name.",
    detectors: [{ kind: "step", label: "validate-css-tokens" }],
  },
  {
    id: "forge-turnstile-no-ready",
    statement: "The Turnstile controller never calls `turnstile.ready()`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`(?<!\x60)\bturnstile\.ready\(`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        pcre: true,
        level: "fail",
        examples: {
          hits: [["src/ui/client/turnstile.ts", "window.turnstile.ready(render);"]],
          passes: [["src/ui/client/turnstile.ts", "// than through `turnstile.ready()`, which throws for a script loaded async."]],
        },
      },
    ],
  },
  {
    id: "forge-contextmenu-buttons-guard",
    statement: "A `contextmenu` open passes `afterPointerUp` as `event.buttons !== 0`, never a flat `true`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bafterPointerUp:\s*true\b`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/menu.tsx", "openPopoverAt(popup, x, y, { afterPointerUp: true });"]],
          passes: [["src/ui/core/menu.tsx", "openPopoverAt(popup, x, y, { afterPointerUp: event.buttons !== 0 });"]],
        },
      },
    ],
  },
  {
    id: "forge-announce-own-channel",
    statement: "Code outside `ui` announces on a channel of its own, never on one of forge's `ANNOUNCE_` channel constants.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bannounce\(.*\bANNOUNCE_\w+_CHANNEL\b`,
        paths: ["src/"],
        exclude: ["src/ui/**", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/auth/client/passkey.ts", "announce(text, { channel: ANNOUNCE_TOAST_CHANNEL });"]],
          passes: [
            ["src/auth/client/passkey.ts", "announce(text, { channel: PASSKEY_ANNOUNCE_CHANNEL });"],
            ["src/ui/core/toast.tsx", "announce(text, { channel: ANNOUNCE_TOAST_CHANNEL });"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-busy-cancel-events",
    statement: "The htmx entry cancels the busy channel on `htmx:after:request` and `htmx:error`, never on `htmx:finally:request`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`["']htmx:finally:request["']`,
        paths: ["src/ui/client/"],
        include: ["htmx.ts"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/client/htmx.ts", 'document.addEventListener("htmx:finally:request", cancel);']],
          passes: [["src/ui/client/htmx.ts", 'document.addEventListener("htmx:after:request", cancel);']],
        },
      },
    ],
  },
  {
    id: "forge-command-listener-capture",
    statement: "The invoker-command listener is installed in the capture phase.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`addEventListener\(\s*["']command["'](?![^)]*capture:\s*true)`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        pcre: true,
        level: "fail",
        examples: {
          hits: [["src/ui/client/resume.ts", 'root.addEventListener("command", onCommand);']],
          passes: [["src/ui/client/resume.ts", 'root.addEventListener("command", onCommand, { capture: true });']],
        },
      },
    ],
  },
  {
    id: "forge-htmx-no-cdn",
    statement: "htmx is never loaded from a CDN, since the forge entry point is what pins its version.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`https?://[^"'\x60\s]*htmx`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/server/layout.tsx", '<script src="https://unpkg.com/htmx.org@2"></script>']],
          passes: [["src/ui/client/htmx.ts", 'import htmx from "htmx.org";']],
        },
      },
    ],
  },
  {
    id: "forge-htmx-listeners-on-document",
    statement: "Every listener the htmx entry installs is on `document`, never on `document.body`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bdocument\.body\.addEventListener\(`,
        paths: ["src/ui/client/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/client/htmx.ts", 'document.body.addEventListener("htmx:error", cancel);']],
          passes: [["src/ui/client/htmx.ts", 'document.addEventListener("htmx:error", cancel);']],
        },
      },
    ],
  },
  {
    id: "forge-design-marker-prefix",
    statement: "Every rule marker in `src/ui/design/` carries a `forge-ui-` id, and no id is marked twice.",
    detectors: [
      { kind: "step", label: "validate-rules" },
      {
        kind: "rg",
        pattern: String.raw`<!-- rule:(?!forge-ui-)`,
        paths: ["src/ui/design/"],
        include: ["*.md"],
        pcre: true,
        level: "fail",
        examples: {
          hits: [["src/ui/design/floor.md", "<!-- rule:design-wrong-prefix --> Prose."]],
          passes: [["src/ui/design/floor.md", "<!-- rule:forge-ui-focus-ring --> Prose."]],
        },
      },
    ],
  },
  {
    id: "forge-design-rule-in-corpus",
    statement: "A design rule's marker sits under `src/ui/design/`, never under `docs/`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`^(- |\| )?<!-- rule:forge-ui-`,
        paths: ["docs/"],
        include: ["*.md"],
        level: "warn",
        triage:
          "A rule about forge's own component source rather than about a consumer's design, as `FORGE_REVIEW.md`'s `forge-ui-recipe-respelled` is, is legitimate under `docs/`; a design rule or anti-pattern there is the defect.",
        examples: {
          hits: [["docs/UI_SSR_COMPONENTS.md", "<!-- rule:forge-ui-misplaced --> Prose."]],
          passes: [["docs/UI_DESIGN_GUIDANCE.md", "    <!-- rule:forge-ui-color-token-only --> No `#hex` …"]],
        },
      },
    ],
  },
  {
    id: "forge-design-api-exists",
    statement: "The design corpus describes only API forge exports.",
    detectors: [{ kind: "step", label: "validate-design" }],
  },
  {
    id: "forge-lint-no-theme-import",
    statement: "`tooling/lint` never imports `ui/contracts/theme`.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "forge-design-wrong-example-compiles",
    statement: "A Wrong example in the design corpus compiles, so it shows a design mistake rather than an API forge lacks.",
    detectors: [{ kind: "step", label: "validate-design" }],
  },
  {
    id: "forge-labels-from-contracts",
    statement: "Every English name forge emits comes from `src/ui/contracts/labels.ts`, with a prop that overrides it.",
    detectors: [{ kind: "test", path: "src/ui/conformance.test.tsx" }],
  },
  {
    id: "forge-data-slot-merged",
    statement: "A component merges a caller's `data-slot` into its own token list, never replacing it.",
    detectors: [{ kind: "test", path: "src/ui/conformance.test.tsx" }],
  },
  {
    id: "forge-idref-merged",
    statement: "A component merges a caller's `aria-describedby` and `aria-labelledby` ids ahead of its own, never replacing them.",
    detectors: [{ kind: "test", path: "src/ui/core/field.test.tsx" }],
  },
  {
    id: "forge-data-slot-token-select",
    statement: "A selector matches `data-slot` with `~=`, never with `=`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\[data-slot="`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.browser.tsx", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/assets/css/forge-ui.css", '[data-slot="button"] { gap: 0; }']],
          passes: [["src/ui/assets/css/forge-ui.css", '[data-slot~="button"] { gap: 0; }']],
        },
      },
    ],
  },
  {
    id: "forge-turnstile-sitekey-from-env",
    statement: "`Turnstile`'s `siteKey` comes from the Worker env, never from a literal.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bsiteKey:\s*["'\x60]`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.browser.tsx", "*.md", "*.mjs", "*.fixture.ts"],
        level: "fail",
        examples: {
          hits: [["src/auth/web/views/signup.ts", 'Turnstile({ siteKey: "0x4AAAAAAA" });']],
          passes: [
            ["src/auth/web/views/signup.tsx", '<Turnstile siteKey="x" />'],
            ["src/auth/web/views/signup.ts", "Turnstile({ siteKey: c.env.TURNSTILE_SITE_KEY });"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-overlay-native",
    statement: "An overlay builds on the native Popover API, `<dialog>` or `<details>`, never on a JavaScript re-creation.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-otp-frame-clip",
    statement: "`OtpInput`'s frame clips with `overflow-x: clip`, never `hidden`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`overflow-x-hidden|overflow-x:\s*hidden|\boverflow-hidden\b`,
        paths: ["src/ui/core/"],
        include: ["otp-input.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/otp-input.tsx", 'const FRAME = "inline-flex overflow-x-hidden";']],
          passes: [["src/ui/core/otp-input.tsx", 'const FRAME = "inline-flex overflow-x-clip";']],
        },
      },
    ],
  },
  {
    id: "forge-idref-ascii-whitespace",
    statement: "The id-token predicates test for HTML's ASCII whitespace, never JS `\\s`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\\s`,
        paths: ["src/ui/core/"],
        include: ["field.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/core/field.tsx", "const parts = value.split(/\\s+/);"]],
          passes: [["src/ui/core/field.tsx", "const parts = value.split(/[\\t\\n\\f\\r ]+/);"]],
        },
      },
    ],
  },
  {
    id: "forge-navbar-details-not-drawer",
    statement: "`Navbar` keeps `<details>` for its collapsed nav and never imports `Drawer`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["'][^"']*/drawer["']`,
        paths: ["src/ui/chrome/"],
        include: ["navbar*.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/chrome/navbar.tsx", 'import { Drawer } from "../core/drawer";']],
          passes: [["src/ui/chrome/navbar.tsx", 'import { Popover } from "../core/popover";']],
        },
      },
    ],
  },
  {
    id: "forge-no-variant-prop",
    statement: "No component declares a prop named `variant`.",
    detectors: [{ kind: "test", path: "src/ui/conformance.test.tsx" }],
  },
  {
    id: "forge-bound-control-no-data-on",
    statement: "No bound control stamps a `data-on-` action.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`data-on-`,
        paths: ["src/ui/controls/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/controls/input.tsx", '<button data-on-click="toggle">']],
          passes: [["src/ui/controls/input.tsx", '<input data-bind="name">']],
        },
      },
    ],
  },
  {
    id: "forge-icon-shape-no-size",
    statement: 'An icon-only trigger takes `shape="icon"`, never a `size-` or padding class.',
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`(?=.*\bshape=["']icon)(?=.*\bclass=["'][^"']*(?<![\w-])(size|p[xytrbl]?)-)`,
        paths: ["src/"],
        include: ["*.tsx"],
        exclude: ["*.test.*", "*.browser.ts", "*.browser.tsx", "*.md", "*.mjs"],
        pcre: true,
        level: "fail",
        examples: {
          hits: [
            ["src/ui/core/dialog.tsx", '<Dialog.Trigger shape="icon" class="size-8">'],
            ["src/ui/core/dialog.tsx", '<Dialog.Trigger class="px-2" shape="icon">'],
          ],
          passes: [["src/ui/core/dialog.tsx", '<Dialog.Trigger shape="icon" class="text-muted-foreground">']],
        },
      },
    ],
  },
  {
    id: "forge-popover-content-named",
    statement: "Every `Popover.Content` is named by `label` or `labelledby` and takes no `role`.",
    detectors: [{ kind: "step", label: "typecheck" }],
  },
  {
    id: "forge-derived-reference-asserted",
    statement: "A derived reference is emitted only where the caller asserts the element it points at.",
    detectors: [{ kind: "step", label: "typecheck" }],
  },
  {
    id: "forge-design-default-form",
    statement: "A Tier 2 design rule's statement opens with `Default:` and ends with its `unless` override condition.",
    detectors: [
      { kind: "step", label: "validate-rules" },
      { kind: "step", label: "validate-design" },
    ],
  },
  {
    id: "forge-navbar-group-label-p",
    statement: "A `Navbar` group is labelled by a `<p>`, never by a heading element.",
    detectors: [{ kind: "test", path: "src/ui/chrome/navbar-items.test.tsx" }],
  },
  {
    id: "forge-navbar-no-menubar",
    statement: 'The `Navbar` bar never takes `role="menubar"`.',
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`role=["']menubar|role:\s*["']menubar`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "fail",
        examples: {
          hits: [["src/ui/chrome/navbar.tsx", '<nav role="menubar">']],
          passes: [["src/ui/chrome/navbar.tsx", '<div role="group" aria-labelledby={id}>']],
        },
      },
    ],
  },
  {
    id: "forge-auth-passkey-attrs-from-contract",
    statement:
      "A hand-rendered passkey ceremony root takes each attribute name and default from the constants `src/auth/passkey-contract.ts` exports, never a literal.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`data-passkey-[a-z]`,
        paths: ["src/"],
        exclude: ["src/auth/passkey-contract.ts", "*.test.*", "*.browser.ts", "*.md"],
        level: "fail",
        examples: {
          hits: [["src/auth/web/views/passkey-enrol.tsx", '<form data-scope="passkey" data-passkey-mode="registration">']],
          passes: [
            ["src/auth/web/views/passkey-enrol.tsx", '<form data-scope="passkey" {...{ [PASSKEY_MODE_ATTR]: mode }}>'],
            ["src/auth/passkey-contract.ts", 'export const PASSKEY_MODE_ATTR = "data-passkey-mode";'],
          ],
        },
      },
    ],
  },
  {
    id: "forge-auth-last-verified-stamp",
    statement: "Only `FactorStore.recordVerification` and `replaceSecret` write `last_verified_at`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`last_verified_at\s*=`,
        paths: ["src/auth/"],
        exclude: ["*.test.*", "*.md"],
        level: "warn",
        triage:
          "Two hits are the rule's own — the `recordVerification` and `replaceSecret` `UPDATE`s in `stores/factors.ts`; any other statement writing the column is the defect.",
        examples: {
          hits: [["src/auth/stores/factors.ts", "sql`UPDATE auth_factors SET failed_attempts = failed_attempts + 1, last_verified_at = ${at}`"]],
          passes: [["src/auth/stores/factors.ts", "sql`UPDATE auth_factors SET failed_attempts = failed_attempts + 1 WHERE id = ${id}`"]],
        },
      },
    ],
  },
  {
    id: "forge-webhook-signer-per-env",
    statement:
      "Build a webhook signer through `createWebhookSigningResolver` at module scope, never by calling `createWebhookSigning` inside a handler.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`createWebhookSigning\(`,
        paths: ["src/"],
        exclude: ["src/security/webhook.ts", "*.test.*", "*.md"],
        level: "warn",
        triage:
          "A call at module scope builds one signer per isolate and is legitimate; a call inside a handler or middleware body builds one per request and is the defect.",
        examples: {
          hits: [["src/app/webhooks.ts", "const webhooks = createWebhookSigning({ secrets });"]],
          passes: [
            ["src/app/webhooks.ts", "const webhooks = await resolveWebhooks(c);"],
            ["src/security/webhook.ts", "return memoizePerEnv((env: Bindings) => createWebhookSigning(resolve(env)));"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-session-memory-dev-only",
    statement: "Call `createMemorySessionStorage` only from a test, a fixture or a dev-only module, never from code a deployed Worker runs.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`createMemorySessionStorage\(`,
        paths: ["src/"],
        exclude: ["*.test.*", "*.dev.ts", "*.fixture.ts", "*.md"],
        level: "fail",
        examples: {
          hits: [["src/app/session.ts", "const storage = createMemorySessionStorage();"]],
          passes: [
            ["src/app/session.dev.ts", "const storage = createMemorySessionStorage();"],
            ["src/session/mod.ts", 'export { createMemorySessionStorage } from "@remix-run/session/memory-storage";'],
          ],
        },
      },
    ],
  },
  {
    id: "forge-testing-clock-not-sleep",
    statement: "A TTL test advances the clock it injects, never sleeping out a real expiry.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`Bun\.sleep\(|setTimeout\(\w+, \d{4,}\)`,
        paths: ["src/", "warden/src/"],
        include: ["*.test.ts*"],
        level: "warn",
        triage:
          "A wait on a timer the code under test arms and no option can hand a clock is legitimate; a wait that outlasts a TTL a fake or an option could be given a clock for is the defect.",
        examples: {
          hits: [
            ["src/storage/kv/store.test.ts", "await Bun.sleep(1100);"],
            ["src/storage/kv/store.test.ts", "await new Promise((resolve) => setTimeout(resolve, 1500));"],
          ],
          passes: [
            ["src/storage/kv/store.test.ts", "const settled = () => new Promise((resolve) => setTimeout(resolve, 0));"],
            ["src/storage/kv/store.ts", "await Bun.sleep(1100);"],
          ],
        },
      },
    ],
  },
  {
    id: "forge-assets-test-logical-name",
    statement: "A test asserts an asset by its logical name, never by a content-hashed path or a generated `viewBox`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\.[0-9a-f]{8}\.(css|js|mjs|svg|woff2)\b`,
        paths: ["src/"],
        include: ["*.test.ts*"],
        level: "warn",
        triage:
          "A hashed path the test itself hands the code under test — a `createManifest` input, a pipeline fixture — is legitimate; one read off a generated assets artifact is the defect, since `gen types` writes it unhashed.",
        examples: {
          hits: [["src/ui/server/layout.test.tsx", 'expect(html).toBe(\'<link rel="stylesheet" href="/assets/forge-ui.3f9a2b1c.css">\');']],
          passes: [
            ["src/ui/server/layout.test.tsx", 'expect(assets.path("forge-ui.css")).toBe(manifest.path("forge-ui.css"));'],
            ["src/ui/server/layout.tsx", 'const href = "/assets/forge-ui.3f9a2b1c.css";'],
          ],
        },
      },
    ],
  },
  {
    id: "forge-db-schema-by-specifier",
    statement: "A host config names forge's own schema with `forgeSchema`, never by a `node_modules/` path.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`node_modules/`,
        paths: ["config/", "tests/"],
        include: ["db.config.ts"],
        level: "fail",
        examples: {
          hits: [["config/db.config.ts", 'export default defineDbConfig({ schemas: ["node_modules/@y-core/forge/src/auth/schema.sql"] });']],
          passes: [["config/db.config.ts", 'export default defineDbConfig({ schemas: [forgeSchema("auth"), "config/db/schema.sql"] });']],
        },
      },
    ],
  },
  {
    id: "forge-gate-playwright-no-watches",
    statement: "A Playwright row in a step table declares no `watches`.",
    detectors: [{ kind: "test", path: "src/tooling/gate/builders.test.ts" }],
  },
  {
    id: "forge-gate-markdown-off-formatter",
    statement: "A project running `validate-markdown` puts every markdown file in `.oxfmtrc.json`'s `ignorePatterns`.",
    detectors: [{ kind: "step", label: "validate-config-files" }],
  },
  {
    id: "forge-playwright-config-node-subpaths",
    statement: "`playwright.config.ts` imports forge only through a subpath `forge.node` lists.",
    detectors: [{ kind: "step", label: "validate-config-files" }],
  },
  {
    id: "forge-container-no-export",
    statement: "A container — `storage`, `ui`, `crypto`, `render`, `tooling` — has no export subpath of its own, only its children do.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`^\s*"\./(storage|ui|crypto|render|tooling)"\s*:`,
        paths: ["package.json"],
        level: "fail",
        examples: { hits: [["package.json", '    "./storage": "./src/storage/mod.ts",']], passes: [["package.json", '    "./storage/db": {']] },
      },
    ],
  },
  {
    id: "forge-node-shim-own-program",
    statement: "A suite referencing the node shim compiles in a program of its own, never beside the Worker files.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-server-not-in-browser",
    statement: "No browser entry — a `…/client` namespace or a `client.ts` module — imports `ui/server`.",
    detectors: [
      { kind: "step", label: "validate-namespace-graph" },
      {
        // The step sees namespaces, so a `client.ts` entry inside a namespace that may import `ui/server` needs the line pattern too.
        kind: "rg",
        pattern: String.raw`from "(?:\.\./)+server/|from "@y-core/forge/ui/server"`,
        paths: ["src/ui/"],
        include: ["client.ts", "src/ui/client/*", "src/ui/client/*/*"],
        exclude: ["*.test.*", "*.browser.ts"],
        level: "fail",
        examples: {
          hits: [
            ["src/ui/chrome/client.ts", 'import { Resumable } from "../server/mod";'],
            ["src/ui/client/probe.ts", 'import { Resumable } from "../server/mod";'],
          ],
          passes: [["src/ui/chrome/menu.tsx", 'import { Resumable } from "../server/mod";']],
        },
      },
    ],
  },
  {
    id: "forge-resumable-name-registered",
    statement: "A `Resumable`'s `name` is a scope some client module registers with `registerScope`.",
    detectors: [{ kind: "runtime" }],
  },
]);
