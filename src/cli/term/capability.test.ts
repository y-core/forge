import { describe, expect, it } from "bun:test";

import type { CapabilityInput, ColorLevel } from "./capability";
import { resolveColorLevel } from "./capability";

// One row per precedence rule. Table-driven and pure: not one of these mutates `process.env`, so
// the order below is asserted rather than hoped for.
const CASES: readonly [string, CapabilityInput, ColorLevel][] = [
  ["nothing set at all", { env: {} }, 0],
  ["FORCE_COLOR=0 beats every enabling signal", { env: { FORCE_COLOR: "0", COLORTERM: "truecolor" }, isTTY: true }, 0],
  ["FORCE_COLOR=1", { env: { FORCE_COLOR: "1" } }, 1],
  ["FORCE_COLOR=2", { env: { FORCE_COLOR: "2" } }, 2],
  ["FORCE_COLOR=3 beats NO_COLOR, CI and a closed TTY", { env: { FORCE_COLOR: "3", NO_COLOR: "1", CI: "1" }, isTTY: false }, 3],
  ["FORCE_COLOR above 3 clamps", { env: { FORCE_COLOR: "9" } }, 3],
  ["FORCE_COLOR empty means basic colour", { env: { FORCE_COLOR: "" } }, 1],
  ["FORCE_COLOR=true means basic colour", { env: { FORCE_COLOR: "true" } }, 1],
  ["FORCE_COLOR=false disables", { env: { FORCE_COLOR: "false" } }, 0],
  ["FORCE_COLOR=nonsense is ignored", { env: { FORCE_COLOR: "yes", COLORTERM: "truecolor" } }, 3],
  ["NO_COLOR disables even a truecolor terminal", { env: { NO_COLOR: "", COLORTERM: "truecolor" } }, 0],
  ["--no-color disables", { env: { COLORTERM: "truecolor" }, argv: ["--no-color"] }, 0],
  ["--color=never disables", { env: { COLORTERM: "truecolor" }, argv: ["--color=never"] }, 0],
  ["--color=16m forces truecolor", { env: {}, argv: ["--color=16m"] }, 3],
  ["--color=truecolor forces truecolor", { env: {}, argv: ["--color=truecolor"] }, 3],
  ["--color=256 forces 256", { env: {}, argv: ["--color=256"] }, 2],
  ["--color forces basic", { env: {}, argv: ["--color"] }, 1],
  ["--color=always forces basic", { env: {}, argv: ["--color=always"] }, 1],
  ["TERM=dumb disables", { env: { TERM: "dumb", COLORTERM: "truecolor" }, isTTY: true }, 0],
  ["a --color flag still wins over TERM=dumb", { env: { TERM: "dumb" }, argv: ["--color=256"] }, 2],
  ["GitHub Actions", { env: { CI: "true", GITHUB_ACTIONS: "true" } }, 3],
  ["CircleCI", { env: { CI: "true", CIRCLECI: "true" } }, 3],
  ["GitLab CI", { env: { CI: "true", GITLAB_CI: "true" } }, 1],
  ["codeship", { env: { CI: "true", CI_NAME: "codeship" } }, 1],
  ["Azure Pipelines, folded into the CI branch", { env: { TF_BUILD: "True", AGENT_NAME: "agent" } }, 1],
  ["an unrecognised CI, which must not be assumed to render colour", { env: { CI: "true" } }, 0],
  ["CI is decided before COLORTERM", { env: { CI: "true", COLORTERM: "truecolor" } }, 0],
  ["COLORTERM=truecolor", { env: { COLORTERM: "truecolor" } }, 3],
  ["kitty", { env: { TERM: "xterm-kitty" } }, 3],
  ["ghostty", { env: { TERM: "xterm-ghostty" } }, 3],
  ["wezterm", { env: { TERM: "wezterm" } }, 3],
  ["iTerm 3 and later", { env: { TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.4.0" } }, 3],
  ["iTerm before 3", { env: { TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.9.0" } }, 2],
  ["Apple Terminal", { env: { TERM_PROGRAM: "Apple_Terminal" } }, 2],
  ["Windows Terminal", { env: { WT_SESSION: "abc" } }, 3],
  ["a 256-color TERM, even when piped", { env: { TERM: "xterm-256color" }, isTTY: false }, 2],
  ["a colour TERM on a terminal", { env: { TERM: "xterm" }, isTTY: true }, 1],
  ["the same TERM when piped", { env: { TERM: "xterm" }, isTTY: false }, 0],
  ["COLORTERM present but unrecognised, on a terminal", { env: { COLORTERM: "1" }, isTTY: true }, 1],
  ["an unknown TERM on a terminal", { env: { TERM: "wat" }, isTTY: true }, 0],
];

describe("resolveColorLevel()", () => {
  for (const [name, input, expected] of CASES) {
    it(`resolves ${name}`, () => {
      expect(resolveColorLevel(input)).toBe(expected);
    });
  }
});
