import { defineRules } from "../../define";

export default defineRules([
  {
    id: "libs-testing-exact-match",
    statement: "Assert markup with `toBe` on the full string or an extracted fragment, never with a substring match.",
    detectors: [{ kind: "lint", key: "forge/exact-markup-assertion" }],
  },
  {
    id: "libs-testing-runner-imports",
    statement: "Import every test utility from the runner itself, never from an assertion or mocking library layered over it.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["'](?:chai|sinon|jest|vitest|@jest/[^"']+|@testing-library/[^"']+)["']`,
        paths: ["."],
        include: ["*.test.ts", "*.test.tsx", "*.browser.ts", "*.browser.tsx"],
        level: "warn",
        triage: "A browser driver is the one external test dependency allowed; any other assertion or mocking import is the defect.",
      },
    ],
  },
  {
    id: "libs-testing-no-runtime-types",
    statement: "Never add the runtime's published type package, directly or as a transitive dependency of a convenience plugin.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"(?:bun-types|@types/bun)"`,
        paths: ["package.json", "bun.lock"],
        level: "warn",
        triage: "A lock entry is the transitive case and still the defect; a hit only names the package in a script or a comment.",
      },
    ],
  },
  {
    id: "libs-testing-runtime-global-ban",
    statement: "Worker source reaches no `process`, no `Buffer` and no runtime namespace, as a global or through the module that supplies it.",
    detectors: [
      { kind: "lint", key: "eslint/no-restricted-globals" },
      { kind: "lint", key: "eslint/no-restricted-imports" },
    ],
  },
  {
    id: "libs-testing-no-dom-shim",
    statement: "Never add a DOM shim to the unit runner.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"(?:happy-dom|jsdom|@happy-dom/[^"]+)"`,
        paths: ["package.json", "bun.lock"],
        level: "warn",
        triage: "A lock entry pulled in by a tool that never loads it into the unit runner is fine; a shim the runner preloads is the defect.",
      },
    ],
  },
  {
    id: "libs-testing-browser-state",
    statement: "A browser case asserts a DOM or focus state, never a call count.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`toHaveBeenCalled|\.callCount\b|calls\.length`,
        paths: ["."],
        include: ["*.browser.ts", "*.browser.tsx"],
        level: "warn",
        triage: "A count read to wait for a state the case then asserts is fine; a count that is itself the assertion is the defect.",
      },
    ],
  },
  {
    id: "libs-testing-colocated",
    statement: "Test files never go in a top-level `__tests__/` or `tests/` directory.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(?:describe|it|test)\(`,
        paths: ["."],
        include: ["tests/**/*.test.*", "**/__tests__/**"],
        level: "warn",
        triage: "A fixture application under `tests/`, whose own layout a consumer would use, is fine; a library test placed there is the defect.",
      },
    ],
  },
  {
    id: "libs-testing-concrete-import",
    statement: "A test imports the concrete source file, never the namespace barrel or the package name.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["'](?:\.{1,2}/)+(?:[\w.-]+/)*mod(?:\.tsx?)?["']`,
        paths: ["."],
        include: ["*.test.ts", "*.test.tsx"],
        level: "warn",
        triage:
          "A barrel's own test, which exists to hold the published surface, imports the barrel legitimately; any other test doing so is the defect.",
      },
    ],
  },
  {
    id: "libs-testing-no-mock-library",
    statement: "Never install or add a mock library.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"(?:sinon|testdouble|jest-mock|ts-mockito|@sinonjs/[^"]+)"`,
        paths: ["package.json"],
        level: "warn",
        triage: "A hit only names the package in a script or a comment; a dependency entry is the defect.",
      },
    ],
  },
  {
    id: "libs-testing-test-only-unpublished",
    statement: "A module only a test reaches never ships in the published package.",
    detectors: [{ kind: "step", label: "validate-packaging" }],
  },
]);
