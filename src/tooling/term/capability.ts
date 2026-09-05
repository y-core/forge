// Precedence order adapted from @visulima/is-ansi-color-supported (MIT, Copyright (c) visulima),
// itself after chalk/supports-color (MIT, Copyright (c) Sindre Sorhus)
// https://github.com/visulima/visulima — packages/terminal/is-ansi-color-supported/src/is-color-supported.server.ts

/** How much colour a stream can carry: none, 16, 256, or 24-bit. @public */
export type ColorLevel = 0 | 1 | 2 | 3;

/** Everything the resolver is allowed to look at. @public */
export interface CapabilityInput {
  /** The environment, passed in rather than read — see `resolveColorLevel`. */
  env: Readonly<Record<string, string | undefined>>;
  /** Whether the stream being resolved for is attached to a terminal. */
  isTTY?: boolean;
  /** Command line, for the `--color` family of flags. */
  argv?: readonly string[];
}

const NO_COLOR_FLAG = /^-{1,2}(?:no-color|no-colors|color=false|color=never)$/;
const COLOR_256_FLAG = /^-{1,2}color=256$/;
const COLOR_TRUE_FLAG = /^-{1,2}color=(?:16m|full|truecolor)$/;
const COLOR_ON_FLAG = /^-{1,2}(?:color|colors|color=true|color=always)$/;
const DUMB_TERM = /-mono|dumb/i;
const TERM_256 = /-256(?:color)?$/i;
const TERM_COLOR = /^screen|^tmux|^xterm|^vt[1-5]\d\d|^ansi|color|mintty|rxvt|cygwin|linux/i;

const TRUECOLOR_CI = ["GITEA_ACTIONS", "CIRCLECI", "GITHUB_WORKFLOW", "GITHUB_ACTIONS"];
const BASIC_CI = ["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE", "TF_BUILD"];

function clamp(value: number): ColorLevel {
  return Math.max(0, Math.min(3, value)) as ColorLevel;
}

/** `FORCE_COLOR`'s meaning, or `undefined` when it is absent or says nothing legible. */
function forced(raw: string | undefined): ColorLevel | undefined {
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "true") return 1;
  if (raw === "false") return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : clamp(parsed);
}

/** The colour level a stream supports, decided from `input` and nothing else. @public */
export function resolveColorLevel(input: CapabilityInput): ColorLevel {
  const env = input.env;
  const argv = input.argv ?? [];
  const flag = (pattern: RegExp) => argv.some((arg) => pattern.test(arg));

  const force = forced(env.FORCE_COLOR);
  if (force !== undefined) return force;

  if ("NO_COLOR" in env || flag(NO_COLOR_FLAG)) return 0;

  if (flag(COLOR_TRUE_FLAG)) return 3;
  if (flag(COLOR_256_FLAG)) return 2;
  if (flag(COLOR_ON_FLAG)) return 1;

  const term = env.TERM ?? "";
  if (DUMB_TERM.test(term)) return 0;

  if ("CI" in env || ("TF_BUILD" in env && "AGENT_NAME" in env)) {
    if (TRUECOLOR_CI.some((name) => name in env)) return 3;
    if (BASIC_CI.some((name) => name in env) || env.CI_NAME === "codeship") return 1;
    return 0;
  }

  // After CI, because a CI runner is never a TTY and an earlier gate would strip colour from every
  // build log; before the advertisements, because a redirected stream gets none of them.
  if (input.isTTY === false) return 0;

  if (env.COLORTERM === "truecolor") return 3;
  if (term === "xterm-kitty" || term === "xterm-ghostty" || term === "wezterm") return 3;

  if (env.TERM_PROGRAM === "iTerm.app") return Number.parseInt(env.TERM_PROGRAM_VERSION ?? "", 10) >= 3 ? 3 : 2;
  if (env.TERM_PROGRAM === "Apple_Terminal") return 2;

  // Stands in for the reference's Windows build-number probe, which would mean declaring
  // `process.platform` and `node:os` for one heuristic. `conhost` falls through to the TTY check.
  if ("WT_SESSION" in env) return 3;

  if (TERM_256.test(term)) return 2;
  if (input.isTTY === true && TERM_COLOR.test(term)) return 1;
  if ("COLORTERM" in env) return 1;

  return 0;
}
