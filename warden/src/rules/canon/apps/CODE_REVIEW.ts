import { defineRules } from "../../define";

export default defineRules([
  {
    id: "apps-code-review-raw-env",
    statement: "Read a secret or a scalar setting through the validated config, never as a raw `c.env` property outside `src/app/config.ts`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`c\.env\.[A-Z_]+`,
        paths: ["src/"],
        exclude: ["src/app/config.ts"],
        level: "warn",
        triage:
          "A binding object — a KV namespace, a database, a rate limiter — is correct and expected; a secret or a scalar setting bypasses schema validation and is a defect (APP_ARCHITECTURE.md §3a).",
      },
    ],
  },
  {
    id: "apps-code-review-controller-fetch",
    statement: "A controller never constructs an outbound call, because a service owns every external request.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bfetch\(`,
        paths: ["src/controllers/"],
        level: "warn",
        triage:
          "Forwarding an incoming `Request` unchanged, or calling a library helper named `fetch`, is fine; constructing an outbound call to an external API is a layer violation (APP_ARCHITECTURE.md §2c).",
      },
    ],
  },
  {
    id: "apps-code-review-facade-breach",
    statement:
      "Never import a package the shared library wraps, in source or in a test, because a test that does bypasses the facade as production code would.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "apps-code-review-client-import",
    statement: "Never import a browser-only module into a Worker-reachable file, which is any file outside `src/client/`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from "[^"]*/client(/|")`,
        paths: ["src/"],
        exclude: ["src/client/**"],
        level: "warn",
        triage:
          "A hit in a view or a controller typechecks and fails on the first real request (BOUNDARIES.md §1b); a type-only import, or a path whose last segment merely is `client` but is no browser module, is fine.",
      },
    ],
  },
  {
    id: "apps-code-review-script-nonce",
    statement: "Every `<script>` a view emits carries the request's nonce, a `src` script included.",
    detectors: [
      {
        kind: "rg",
        pattern: "<script(?![^>]*nonce)",
        paths: ["src/views/"],
        pcre: true,
        level: "warn",
        triage:
          "A `<script src=…>` with no inline body still needs the nonce under a strict policy, so it is a true positive; a `<script>` inside a string that is documentation, not markup, is not.",
      },
    ],
  },
  {
    id: "apps-code-review-substring-markup",
    statement: "Never assert on rendered markup with a substring match.",
    detectors: [
      { kind: "lint", key: "forge/exact-markup-assertion" },
      {
        kind: "rg",
        pattern: String.raw`toContain\(|toMatch\(|\.includes\(`,
        paths: ["."],
        include: ["*.test.ts*"],
        level: "warn",
        triage:
          "Legitimate on non-markup strings — an error message, a log line — and on an array or a `Set`, where they test membership; a hit asserting on rendered markup is a defect (TESTING.md §3a).",
      },
    ],
  },
  {
    id: "apps-code-review-host-header-url",
    statement: "Never build an absolute URL from the `Host` header or an `X-Forwarded-` one, because that lets the client choose the origin.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`headers\.get\(['"](host|x-forwarded-[a-z]+)['"]\)`,
        paths: ["src/"],
        ignoreCase: true,
        level: "warn",
        triage:
          "A hit that only logs the value, or compares it against configured values, is fine; one whose value reaches a redirect, an emailed link or a callback address trusts a header without a decision to (BOUNDARIES.md §3c).",
      },
    ],
  },
  {
    id: "apps-code-review-open-redirect",
    statement: "A redirect target read from the query reaches a redirect only through the library's check, never a local one.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`searchParams\.get\(['"](next|return|returnTo|redirect|redirectTo|url)['"]\)`,
        paths: ["src/"],
        level: "warn",
        triage:
          "A hit that never reaches a redirect is fine; one passed to a redirect is an open redirect unless the library's check runs first (FORGE_CONSUMPTION.md §3d).",
      },
    ],
  },
  {
    id: "apps-code-review-method-override",
    statement: "Never route a request by a method-override field or header.",
    detectors: [
      {
        kind: "rg",
        pattern: "_method|x-http-method-override",
        paths: ["src/"],
        ignoreCase: true,
        level: "warn",
        triage:
          "A hit in a test asserting the override is refused is fine; one that reads the value to change how a request is routed is the defect (BOUNDARIES.md §2e).",
      },
    ],
  },
]);
