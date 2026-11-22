import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import { bindingSetSchema, validateBindings } from "../context/env-validation";
import { refuseHookCtx } from "../context/refusal";
import type { BindingSpec, RefuseHook } from "../context/types";
import { assertCsrfMaxAge, assertCsrfRing, csrfMintStage, csrfVerifyStage } from "../form/csrf";
import { requestLogger } from "../logging/request-logger";
import { originProtection } from "../security/cop";
import { createSecurityHeaders } from "../security/headers";
import { rateLimit, rateLimitsCtx } from "../security/rate-limit";
import { composeRefuseHooks, createRefusalAnswer } from "../security/refusal";
import { cfHeadersTrustedCtx, requestId } from "../security/request-id";
import { sessionCtx } from "../session/session";
import type { SessionMiddleware } from "../session/types";
import type { Forge } from "./forge-app";
import { compileGuardMatcher } from "./forge-app";
import type { MiddlewareChainOptions, MiddlewareContribution, MiddlewareCsrfPolicy, MiddlewareGlobal, MiddlewareGuardGroup } from "./types";

type GroupRateLimit<Bindings> = Exclude<NonNullable<MiddlewareGuardGroup<Bindings>["rateLimit"]>, readonly unknown[]>;

/** A group's rate limits in the order they run, one entry or several. */
function groupRateLimits<Bindings>(group: MiddlewareGuardGroup<Bindings>): readonly GroupRateLimit<Bindings>[] {
  const { rateLimit: limits } = group;
  if (limits === undefined) return [];
  return Array.isArray(limits) ? limits : [limits as GroupRateLimit<Bindings>];
}

/** Compiles `exclude` into one matcher and returns a wrapper that makes handlers pass a request it matches straight to `next()`. */
function excluding(exclude: readonly string[] | undefined): (handlers: readonly Middleware[]) => Middleware[] {
  if (!exclude?.length) return (handlers) => [...handlers];
  const matcher = compileGuardMatcher(exclude);
  const verdicts = new WeakMap<RequestContext, boolean>();
  const isExcluded = (context: RequestContext): boolean => {
    let verdict = verdicts.get(context);
    if (verdict === undefined) {
      verdict = matcher === null || matcher.match(context.url) !== null;
      verdicts.set(context, verdict);
    }
    return verdict;
  };
  return (handlers) =>
    handlers.map(
      (handler): Middleware =>
        (context, next) =>
          isExcluded(context) ? next() : handler(context, next),
    );
}

/** The middleware a `globals` entry carries, with its `exclude` applied. */
function globalStage(entry: Middleware | MiddlewareGlobal): Middleware[] {
  return typeof entry === "function" ? [entry] : excluding(entry.exclude)([entry.middleware]);
}

/** `options` with the group's refusal hook behind the stage's own, answering whatever the stage's declines. */
function withGroupHook<Options extends { onRefuse?: RefuseHook<Bindings> }, Bindings>(
  options: Options,
  onRefuse: RefuseHook<Bindings> | undefined,
): Options {
  const own = options.onRefuse;
  if (onRefuse === undefined) return options;
  if (own === undefined) return { ...options, onRefuse };
  return { ...options, onRefuse: composeRefuseHooks(own, onRefuse) };
}

/** Whether a group carries a CSRF verify stage: it has an origin check, a rate limit or guards. */
function groupVerifies<Bindings>(group: MiddlewareGuardGroup<Bindings>): boolean {
  return group.origin !== undefined || groupRateLimits(group).length > 0 || (group.guards?.length ?? 0) > 0;
}

/** The refusal hook of the last-registered verifying group whose pre stages ran on this request, answering its CSRF refusal. */
// oxlint-disable-next-line typescript/no-explicit-any -- groups of every bindings shape publish here
const csrfRefuseHookCtx = contextVar<RefuseHook<any>>("csrfRefuseHook");

/** Builds a group's shape, origin and rate-limit stages: every stage that runs ahead of CSRF verification. */
function guardPreStages<Bindings extends object>(group: MiddlewareGuardGroup<Bindings>): Middleware[] {
  const { onRefuse } = group;
  const publishHook: Middleware[] =
    onRefuse !== undefined && groupVerifies(group)
      ? [
          (context, next) => {
            csrfRefuseHookCtx.set(context, onRefuse);
            return next();
          },
        ]
      : [];
  return [
    ...publishHook,
    ...(group.shape ?? []),
    ...(group.origin ? [originProtection<Bindings>(withGroupHook(group.origin, group.onRefuse))] : []),
    ...groupRateLimits(group).map((limit) => groupRateLimit(group.paths, withGroupHook(limit, group.onRefuse))),
  ];
}

/** Builds a group's armed CSRF verification and its own guards, present whenever the group verifies; a refusal is answered by the hook `csrfRefuseHookCtx` holds, else the group's own. */
function guardPostStages<Bindings extends object>(group: MiddlewareGuardGroup<Bindings>): Middleware[] {
  if (!groupVerifies(group)) return [];
  const verify = csrfVerifyStage((context, refusal) =>
    createRefusalAnswer<Bindings>(csrfRefuseHookCtx.getOptional(context) ?? group.onRefuse)(context, refusal),
  );
  return [verify, ...(group.guards ?? [])];
}

/** Compiles `unboundPaths` into the predicate the mint stage asks of each token's target. */
function unboundTargets(unboundPaths: readonly string[] | undefined): (target: URL) => boolean {
  if (!unboundPaths?.length) return () => false;
  const matcher = compileGuardMatcher(unboundPaths);
  return (target) => matcher === null || matcher.match(target) !== null;
}

// oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
const sessionSubject = (context: RequestContext<any, any>): string => sessionCtx.get(context).id;

/** The paths the app's CSRF policy mints on, and its mint stage with `subject: "session"` resolved and the policy's `exclude` and `unboundPaths` applied. */
function csrfPolicyMint<Bindings>({ paths = ["*"], exclude, unboundPaths, subject, ...options }: MiddlewareCsrfPolicy<Bindings>): {
  paths: readonly string[];
  stages: Middleware[];
} {
  const minted = csrfMintStage({ ...options, subject: subject === "session" ? sessionSubject : subject }, unboundTargets(unboundPaths));
  return { paths, stages: excluding(exclude)([minted]) };
}

/** Throws, naming the slot, on a request the `session` slot's middleware left without a session. */
const assertSessionSet: Middleware = (context, next) => {
  if (sessionCtx.getOptional(context) === undefined) {
    throw new Error(
      "applyMiddlewareChain: the `session` slot's middleware set no session on sessionCtx — pass the SessionMiddleware createAnonymousSession or sessionMiddleware returns.",
    );
  }
  return next();
};

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;

/** `seconds` in the largest whole unit that divides it: `7 days`, `12 hours`, `90 seconds`. */
function inWords(seconds: number): string {
  const [count, unit] =
    seconds % SECONDS_PER_DAY === 0
      ? [seconds / SECONDS_PER_DAY, "day"]
      : seconds % SECONDS_PER_HOUR === 0
        ? [seconds / SECONDS_PER_HOUR, "hour"]
        : [seconds, "second"];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Throws, naming both values, where a contribution needs the session cookie to last longer than the slot's `maxAge` allows, or the slot sets none. */
function assertSessionOutlives<Bindings>(session: SessionMiddleware | undefined, contributions: readonly MiddlewareContribution<Bindings>[]): void {
  const needs = contributions.map((contribution) => contribution.sessionMaxAgeAtLeastMs).filter((ms) => ms !== undefined);
  if (needs.length === 0) return;
  const neededSeconds = Math.ceil(Math.max(...needs) / 1000);
  const needed = `${neededSeconds} seconds (${inWords(neededSeconds)})`;
  if (session === undefined) {
    throw new Error(
      `applyMiddlewareChain: a contribution needs the session cookie to last at least ${needed}, but no source supplies a session slot.`,
    );
  }
  if (session.maxAge === undefined) {
    throw new Error(
      `applyMiddlewareChain: a contribution needs the session cookie to last at least ${needed}, but the session slot's cookie sets no maxAge — set maxAge to at least ${neededSeconds}.`,
    );
  }
  if (session.maxAge < neededSeconds) {
    throw new Error(
      `applyMiddlewareChain: the session slot's cookie maxAge is ${session.maxAge} seconds (${inWords(session.maxAge)}), shorter than the ${needed} a contribution needs it to last — set maxAge to at least ${neededSeconds}.`,
    );
  }
}

/** Whether a request to `url` reaches a stage registered on `paths`. */
function covers(paths: readonly string[], url: URL): boolean {
  const matcher = compileGuardMatcher(paths);
  return matcher === null || matcher.match(url) !== null;
}

/** Each path a root guard group, a contribution or one of its guard groups lists as `csrfCovers`, once, with the source that first listed it. */
function csrfCoverSources<Bindings>(
  rootGuards: readonly MiddlewareGuardGroup<Bindings>[],
  contributions: readonly MiddlewareContribution<Bindings>[],
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const group of rootGuards) {
    const source = `the root guard group \`${group.paths.join(", ")}\``;
    for (const path of group.csrfCovers ?? []) if (!sources.has(path)) sources.set(path, source);
  }
  for (const [index, contribution] of contributions.entries()) {
    for (const path of contribution.csrfCovers ?? []) if (!sources.has(path)) sources.set(path, `contribution ${index}`);
    for (const group of contribution.guards ?? []) {
      const source = `contribution ${index}'s guard group \`${group.paths.join(", ")}\``;
      for (const path of group.csrfCovers ?? []) if (!sources.has(path)) sources.set(path, source);
    }
  }
  return sources;
}

/** Throws, naming the route, the contribution or guard group listing it and the policy's `paths` or the `exclude` entry, where a listed route is one the CSRF policy mints no token on. */
function assertCsrfCovers<Bindings>(
  policy: MiddlewareCsrfPolicy<Bindings> | undefined,
  rootGuards: readonly MiddlewareGuardGroup<Bindings>[],
  contributions: readonly MiddlewareContribution<Bindings>[],
): void {
  for (const [path, source] of csrfCoverSources(rootGuards, contributions)) {
    const route = `${source}'s route \`${path}\``;
    if (policy === undefined) {
      throw new Error(
        `applyMiddlewareChain: ${route} mints a CSRF token, but no csrf policy is set — pass applyMiddlewareChain's root csrf option.`,
      );
    }
    const url = new URL(path, "http://forge.invalid");
    const paths = policy.paths ?? ["*"];
    if (!covers(paths, url)) {
      throw new Error(
        `applyMiddlewareChain: ${route} mints a CSRF token, but the csrf policy's paths \`${paths.join(", ")}\` leave it uncovered — add a pattern that matches it.`,
      );
    }
    const excluded = policy.exclude?.find((entry) => covers([entry], url));
    if (excluded !== undefined) {
      throw new Error(
        `applyMiddlewareChain: ${route} mints a CSRF token, but the csrf policy's exclude entry \`${excluded}\` skips it — narrow the entry so it leaves the route covered.`,
      );
    }
  }
}

/** Builds a group's rate limit, naming the group when its options are refused. */
function groupRateLimit<Bindings extends object>(paths: readonly string[], options: GroupRateLimit<Bindings>): Middleware {
  try {
    return rateLimit<Bindings>(options);
  } catch (error) {
    throw new Error(`guard group \`${paths.join(", ")}\`: ${(error as Error).message}`, { cause: error });
  }
}

/** Throws, naming the group's paths, where a group's rate limit would key by client IP under a chain that distrusts the CF headers. */
function assertLimitsKeyable<Bindings>(groups: readonly MiddlewareGuardGroup<Bindings>[], cfHeadersTrusted: boolean): void {
  if (cfHeadersTrusted) return;
  const unkeyed = groups.find((group) => groupRateLimits(group).some((limit) => limit.key === undefined));
  if (unkeyed !== undefined) {
    throw new Error(
      `guard group \`${unkeyed.paths.join(", ")}\`: its \`rateLimit\` keys by client IP, which needs \`trustCfHeaders: true\` on \`applyMiddlewareChain\`, or a custom \`key\`.`,
    );
  }
}

/** The binding names the chain's `bindings` schema declares, throwing where it is no object schema to read them from. */
function declaredBindingNames(bindings: MiddlewareChainOptions["bindings"], specs: readonly BindingSpec[], paths: readonly string[]): Set<string> {
  const names = new Set(specs.map((spec) => spec.name));
  if (bindings === undefined) return names;
  if (!("entries" in bindings) || typeof bindings.entries !== "object" || bindings.entries === null) {
    throw new Error(
      `guard group \`${paths.join(", ")}\`: its \`rateLimit\` names a binding, and the chain's \`bindings\` schema is not a valibot object schema to find it in — pass \`bindings\` as \`v.object(...)\`, or declare the binding as a contribution's BindingSpec.`,
    );
  }
  for (const name of Object.keys(bindings.entries)) names.add(name);
  return names;
}

/** Throws, naming the group's paths and what is missing, where a group's rate limit names a binding the chain does not declare in both `bindings` and `rateLimits`. */
function assertLimitBindingsDeclared<Bindings>(
  groups: readonly MiddlewareGuardGroup<Bindings>[],
  bindings: MiddlewareChainOptions["bindings"],
  specs: readonly BindingSpec[],
  rateLimits: MiddlewareChainOptions["rateLimits"],
): void {
  let declared: Set<string> | undefined;
  for (const group of groups) {
    for (const { binding } of groupRateLimits(group)) {
      const where = `guard group \`${group.paths.join(", ")}\``;
      declared ??= declaredBindingNames(bindings, specs, group.paths);
      if (!declared.has(binding)) {
        throw new Error(
          `${where}: its \`rateLimit\` names the binding "${binding}", which neither the chain's \`bindings\` schema nor a contribution's BindingSpecs declares — declare it there, required or optional.`,
        );
      }
      if (rateLimits === undefined || !Object.hasOwn(rateLimits, binding)) {
        throw new Error(
          `${where}: its \`rateLimit\` names the binding "${binding}", which is not a key of the chain's \`rateLimits\` — pass the generated RATELIMITS, declaring "${binding}" in wrangler.jsonc's \`ratelimits\`.`,
        );
      }
    }
  }
}

/** Expands one guard group into the ordered chain `app.use` takes: shape, origin, rate limit, then — when it has an origin check, a rate limit or guards — armed CSRF verification and its own guards. @internal */
export function buildGuardChain<Bindings extends object = Record<string, unknown>>(group: MiddlewareGuardGroup<Bindings>): Middleware[] {
  return excluding(group.exclude)([...guardPreStages(group), ...guardPostStages(group)]);
}

/** Registers the canonical forge middleware chain on `app`, encoding its load-bearing order once. @public */
export function applyMiddlewareChain<Bindings extends object = Record<string, unknown>>(
  app: Forge<Bindings>,
  options: MiddlewareChainOptions<Bindings>,
): void {
  const trustCfHeaders = options.trustCfHeaders === true;
  const contributions = options.contributions ?? [];

  const carrier = contributions.findIndex((contribution) => "csrf" in contribution);
  if (carrier !== -1) {
    throw new Error(
      `applyMiddlewareChain: contribution ${carrier} carries a csrf policy, and the app root owns it — move it to applyMiddlewareChain's root csrf option.`,
    );
  }

  const sessions = [options.session, ...contributions.map((contribution) => contribution.session)].filter((session) => session !== undefined);
  if (sessions.length > 1) throw new Error("applyMiddlewareChain: two sources each supply a session, and the chain takes one.");

  const specs = contributions.flatMap((contribution) => contribution.bindings ?? []);
  const names = specs.map((spec) => spec.name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) throw new Error(`applyMiddlewareChain: the binding "${repeated}" is contributed twice.`);

  const globals = [...(options.globals ?? []), ...contributions.flatMap((contribution) => contribution.globals ?? [])];
  const guards = [...(options.guards ?? []), ...contributions.flatMap((contribution) => contribution.guards ?? [])];
  const [session] = sessions;
  assertSessionOutlives(session, contributions);
  const policy = options.csrf;
  assertCsrfMaxAge("applyMiddlewareChain", policy?.maxAgeMs);
  assertCsrfRing("applyMiddlewareChain", policy?.ring);
  if (policy?.subject === "session" && session === undefined) {
    throw new Error('applyMiddlewareChain: the csrf policy\'s subject is "session", but no source supplies a session slot to bind it to.');
  }
  const mint = policy === undefined ? null : csrfPolicyMint(policy);

  for (const paths of [...guards.map((group) => group.paths), ...(mint ? [mint.paths] : [])]) compileGuardMatcher(paths);
  assertCsrfCovers(policy, options.guards ?? [], contributions);
  assertLimitBindingsDeclared(guards, options.bindings, specs, options.rateLimits);
  assertLimitsKeyable(guards, trustCfHeaders);

  const globalStages = globals.flatMap(globalStage);
  const stages = guards.map((group) => {
    const skipExcluded = excluding(group.exclude);
    const guarded = guardPostStages(group);
    return { pre: skipExcluded(guardPreStages(group)), guarded: skipExcluded(guarded) };
  });

  const { onRefuse, rateLimits } = options;
  if (trustCfHeaders || onRefuse || rateLimits) {
    app.use("*", (context, next) => {
      if (trustCfHeaders) cfHeadersTrustedCtx.set(context, true);
      if (onRefuse) refuseHookCtx.set(context, onRefuse);
      if (rateLimits) rateLimitsCtx.set(context, rateLimits);
      return next();
    });
  }
  if (options.before?.length) app.use("*", ...options.before);
  if (options.requestId !== false) app.use("*", requestId({ trustCfHeaders }));
  if (options.logging) app.use("*", requestLogger<Bindings>(options.logging));
  app.use("*", createSecurityHeaders(options.securityHeaders));
  if (options.bindings) app.use("*", validateBindings(options.bindings));
  if (specs.length > 0) app.use("*", validateBindings(bindingSetSchema(specs)));
  if (session) app.use("*", session, assertSessionSet);
  if (mint) app.use(mint.paths, ...mint.stages);
  if (globalStages.length) app.use("*", ...globalStages);

  guards.forEach((group, index) => app.use(group.paths, ...(stages[index]?.pre ?? [])));
  guards.forEach((group, index) => {
    const guarded = stages[index]?.guarded ?? [];
    if (guarded.length) app.use(group.paths, ...guarded);
  });
}
