// Generated from src/storage/db/mod.ts by `bun run gen:bundles` — do not edit.

// src/storage/db/uuid.ts
var VERSION_7 = 28672;
var VARIANT_CLEAR_MASK = 63;
var VARIANT_BITS = 128;
var COUNTER_MAX = 4095;
var COUNTER_SEED_MASK = 1023;
var MAX_UNIX_TS_MS = 281474976710655;
var BYTE_LENGTH = 16;
var HYPHEN_BEFORE_OCTET = /* @__PURE__ */ new Set([4, 6, 8, 10]);
var CANONICAL_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function randomCounterSeed() {
  const seed = crypto.getRandomValues(new Uint8Array(2));
  return new DataView(seed.buffer).getUint16(0) & COUNTER_SEED_MASK;
}
function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}
function uuidFromBytes(value) {
  const bytes = asBytes(value);
  if (bytes.byteLength !== BYTE_LENGTH) {
    throw new Error(`uuidFromBytes: expected ${BYTE_LENGTH} bytes, received ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (let octet = 0; octet < BYTE_LENGTH; octet++) {
    if (HYPHEN_BEFORE_OCTET.has(octet)) out += "-";
    out += view.getUint8(octet).toString(16).padStart(2, "0");
  }
  return out;
}
function uuidToBytes(id) {
  if (!CANONICAL_UUID_RE.test(id)) {
    throw new Error(`uuidToBytes: expected a canonical 36-character UUID, received ${JSON.stringify(id)}`);
  }
  const hex = id.replace(/-/g, "");
  const bytes = new Uint8Array(BYTE_LENGTH);
  for (let octet = 0; octet < BYTE_LENGTH; octet++) {
    bytes[octet] = Number.parseInt(hex.slice(octet * 2, octet * 2 + 2), 16);
  }
  return bytes;
}
function createUuidv7Bytes(options) {
  const now = options?.now ?? Date.now;
  let lastMs = -1;
  let counter = 0;
  return () => {
    const wall = Math.floor(now());
    if (!Number.isFinite(wall) || wall < 0) {
      throw new Error(`uuidv7: clock returned an invalid Unix millisecond value: ${wall}`);
    }
    let timestamp;
    if (wall > lastMs) {
      timestamp = wall;
      counter = randomCounterSeed();
    } else {
      timestamp = lastMs;
      counter += 1;
      if (counter > COUNTER_MAX) {
        timestamp = lastMs + 1;
        counter = randomCounterSeed();
      }
    }
    if (timestamp > MAX_UNIX_TS_MS) {
      throw new Error(`uuidv7: timestamp ${timestamp} exceeds the 48-bit unix_ts_ms field`);
    }
    lastMs = timestamp;
    const bytes = new Uint8Array(BYTE_LENGTH);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, Math.floor(timestamp / 4294967296));
    view.setUint32(2, timestamp >>> 0);
    view.setUint16(6, VERSION_7 | counter);
    crypto.getRandomValues(bytes.subarray(8));
    view.setUint8(8, view.getUint8(8) & VARIANT_CLEAR_MASK | VARIANT_BITS);
    return bytes;
  };
}
function createUuidv7(options) {
  const generate = createUuidv7Bytes(options);
  return () => uuidFromBytes(generate());
}
var defaultGenerator = createUuidv7Bytes();
function uuidv7() {
  return uuidFromBytes(defaultGenerator());
}
function uuidv7Bytes() {
  return defaultGenerator();
}

// src/validation/validation.ts
import * as v from "valibot";

// src/validation/safe-check.ts
var VOUCHED = /* @__PURE__ */ new WeakMap();
function safeCheck(requirement, message) {
  VOUCHED.set(requirement, message);
  return v.check(requirement, message);
}
function vouchedMessage(issue) {
  const requirement = issue.requirement;
  return typeof requirement === "function" ? VOUCHED.get(requirement) : void 0;
}

// src/validation/format-issues.ts
var UNNAMED_FIELD = "the submitted form";
var PATH_DEPTH_MAX = 3;
var PATH_SEGMENT_MAX = 40;
var ENV_UNNAMED_FIELD = "root";
function describeValidationField(path) {
  const bounded = path.slice(0, PATH_DEPTH_MAX).map((segment) => segment.slice(0, PATH_SEGMENT_MAX));
  return bounded.length === 0 ? UNNAMED_FIELD : bounded.join(".");
}
function issuePathSegments(issue) {
  return (issue.path ?? []).map((item) => item.key).filter((key) => typeof key === "string" || typeof key === "number").map(String);
}
function describeEnvIssue(issue) {
  const named = issuePathSegments(issue);
  const field = named.length === 0 ? ENV_UNNAMED_FIELD : describeValidationField(named);
  if (issue.received === "undefined") return `${field}: missing`;
  return `${field}: ${vouchedMessage(issue) ?? issue.type}`;
}
function formatEnvIssues(issues) {
  return issues.map(describeEnvIssue).join("; ");
}

// src/validation/parse-env.ts
function parseEnv(schema, input) {
  const result = v.safeParse(schema, input);
  if (!result.success) {
    throw new Error(`Invalid environment: ${formatEnvIssues(result.issues)}`);
  }
  return result.output;
}

// src/context/types.ts
import { createContextKey, RequestContext } from "@remix-run/fetch-router";
import { createContextKey as createContextKey2 } from "@remix-run/fetch-router";

// src/context/request-scope.node.ts
var RequestFreeBundleError = class extends Error {
  name = "RequestFreeBundleError";
  constructor() {
    super(
      "forge's `node` export condition loads a request-free bundle, which holds no request state of its own \u2014 serve requests through the TypeScript source (docs/TEST_RUNNERS.md \xA77f)"
    );
  }
};
var requestScope = {
  read: () => {
    throw new RequestFreeBundleError();
  },
  write: () => {
    throw new RequestFreeBundleError();
  }
};

// src/context/types.ts
var EnvKey = createContextKey2();
var ExecutionContextKey = createContextKey2();
var ConfigKey = createContextKey2();
function getAppContext(context) {
  if (requestScope.read(context, EnvKey) === void 0) {
    throw new Error(
      "getAppContext: per-request state is not available \u2014 the Forge router must inject request state (provideRequestState) before this handler runs."
    );
  }
  return context;
}

// src/context/env-validation.ts
function validateEnv(env, schema) {
  return parseEnv(schema, env);
}
function validateBindings(schema) {
  let cachedEnvRef;
  return async (context, next) => {
    const env = getAppContext(context).env;
    if (env !== cachedEnvRef) {
      validateEnv(env, schema);
      cachedEnvRef = env;
    }
    return next();
  };
}
function bindingEntry(spec) {
  const shape = v.pipe(
    v.unknown(),
    safeCheck(
      (val) => typeof val === "object" && val !== null && spec.methods.every((method) => typeof val[method] === "function"),
      `${spec.name} must be ${spec.label}`
    )
  );
  return spec.optional === true ? v.optional(shape) : shape;
}
function bindingSchema(name, methods, label, options = {}) {
  return v.object({ [name]: bindingEntry({ name, methods, label, optional: options.optional }) });
}

// src/logging/log-value.ts
function logSafeUrl(url) {
  return `${url.origin}${url.pathname}`;
}
function urlNarrowing(key, value) {
  const held = this?.[key];
  return held instanceof URL ? logSafeUrl(held) : value;
}

// src/logging/types.ts
var LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
function levelAtLeast(level, min) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

// src/logging/channels.ts
function consoleChannel() {
  return {
    write(record) {
      const { data, ...rest } = record;
      console.log(JSON.stringify({ ...data, ...rest }, urlNarrowing));
    }
  };
}

// src/logging/log-clone.ts
var CIRCULAR_MARKER = "[circular]";
var LOG_REDACTED = "[redacted]";
var LOG_REDACTION_FAILED = "redactionFailed";
function cloneLogValue(value, decide) {
  const openPath = /* @__PURE__ */ new WeakSet();
  function walk(input) {
    if (input === null || typeof input !== "object") return input;
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
    if (input instanceof URL) return logSafeUrl(input);
    if (openPath.has(input)) return CIRCULAR_MARKER;
    openPath.add(input);
    try {
      const toJson = input.toJSON;
      if (typeof toJson === "function") return walk(toJson.call(input));
      if (Array.isArray(input)) return input.map((item) => walk(item));
      if (input instanceof Map) return { type: "Map", entries: [...input].map(([key, val]) => [walk(key), walk(val)]) };
      if (input instanceof Set) return { type: "Set", values: [...input].map((item) => walk(item)) };
      return Object.fromEntries(
        Object.entries(input).flatMap(([key, val]) => {
          const verdict2 = decide(key);
          if (verdict2 === "remove") return [];
          return [[key, verdict2 === "mask" ? LOG_REDACTED : walk(val)]];
        })
      );
    } finally {
      openPath.delete(input);
    }
  }
  return walk(value);
}

// src/logging/redact.ts
var BUILT_IN_STEMS = [
  "email",
  "displayname",
  "username",
  "firstname",
  "lastname",
  "givenname",
  "familyname",
  "fullname",
  "nickname",
  "password",
  "passwd",
  "passphrase",
  "passcode",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
  "signature",
  "otp",
  "body",
  "payload",
  "formdata",
  "authorization",
  "bearer",
  "cookie",
  "session"
];
var ESCAPE = /[.*+?^${}()|[\]\\]/g;
function normalizeLogKey(key) {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}
function usableStems(stems) {
  return stems.map((stem) => normalizeLogKey(stem)).filter((stem) => stem !== "");
}
function alternation(stems) {
  return new RegExp(stems.map((stem) => stem.replace(ESCAPE, "\\$&")).join("|"));
}
function defineLogRedaction(options) {
  const allow = usableStems(options?.allow ?? []);
  return {
    mode: options?.mode ?? "mask",
    deny: alternation([...BUILT_IN_STEMS, ...usableStems(options?.also ?? [])]),
    allow: allow.length > 0 ? alternation(allow) : null
  };
}
var DEFAULT_LOG_REDACTION = defineLogRedaction();
function verdict(key, policy) {
  const normalized = normalizeLogKey(key);
  if (policy.allow?.test(normalized) === true) return "keep";
  return policy.deny.test(normalized) ? policy.mode : "keep";
}
function applyLogRedaction(data, policy) {
  return cloneLogValue(data, (key) => verdict(key, policy));
}

// src/logging/serialize-error.ts
function serializeError(err) {
  if (err instanceof Error) {
    return { type: err.name || "Error", detail: err.message, ...err.stack ? { stack: err.stack } : {} };
  }
  try {
    return { type: typeof err, detail: String(err) };
  } catch {
    return { type: typeof err, detail: "[unserializable thrown value]" };
  }
}

// src/logging/logger.ts
var PENDING_CAP = 1e3;
var REDACTION_OFF = "allow-unredacted-logs";
function reportChannelError(error) {
  console.error(
    JSON.stringify({
      error: serializeError(error),
      level: "error",
      prefix: "logger",
      message: "log channel write failed",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    })
  );
}
function createLogger(prefix, options) {
  const core = {
    channels: options?.channels ?? [consoleChannel()],
    pending: [],
    onChannelError: options?.onChannelError ?? reportChannelError,
    redact: options?.redact === REDACTION_OFF ? null : options?.redact ?? DEFAULT_LOG_REDACTION
  };
  return makeLogger(prefix, options?.bindings ?? {}, core, options?.minLevel);
}
function makeLogger(prefix, bindings, core, minLevel) {
  const { channels, pending } = core;
  function notifyChannelError(error) {
    try {
      core.onChannelError(error);
    } catch {
    }
  }
  function safeData(data) {
    if (Object.keys(bindings).length === 0 && !data) return {};
    try {
      const merged = { ...bindings, ...data };
      return { data: core.redact === null ? merged : applyLogRedaction(merged, core.redact) };
    } catch (error) {
      notifyChannelError(error);
      return { data: { [LOG_REDACTION_FAILED]: true } };
    }
  }
  function dispatch2(level, message, data) {
    if (minLevel !== void 0 && !levelAtLeast(level, minLevel)) return;
    const record = { level, prefix, message, timestamp: (/* @__PURE__ */ new Date()).toISOString(), ...safeData(data) };
    for (const channel of channels) {
      try {
        const result = channel.write(record);
        if (result instanceof Promise) {
          result.catch(notifyChannelError);
          if (pending.length >= PENDING_CAP) {
            pending.splice(0, 1);
          }
          pending.push(result);
        }
      } catch (error) {
        notifyChannelError(error);
      }
    }
  }
  return {
    debug: (message, data) => dispatch2("debug", message, data),
    info: (message, data) => dispatch2("info", message, data),
    warn: (message, data) => dispatch2("warn", message, data),
    error: (message, data) => dispatch2("error", message, data),
    /** Awaits all writes currently tracked as pending and returns once they settle. */
    async flush() {
      const toAwait = pending.splice(0);
      await Promise.allSettled(toAwait);
    },
    child(extra) {
      return makeLogger(prefix, { ...bindings, ...extra }, core, minLevel);
    }
  };
}

// src/context/accessor.ts
import { createContextKey as createContextKey3 } from "@remix-run/fetch-router";
function contextVar(name) {
  const key = createContextKey3();
  return {
    key,
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    get(c, message) {
      const value = requestScope.read(c, key);
      if (value === void 0) {
        throw new Error(message ?? `Context variable "${name}" is not set`);
      }
      return value;
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    set(c, value) {
      requestScope.write(c, key, value);
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    getOptional(c) {
      return requestScope.read(c, key);
    }
  };
}

// src/logging/request-logger.ts
var requestLog = contextVar("logger");
function loggerFor(c, source, fallback) {
  return requestLog.getOptional(c)?.child({ source }) ?? fallback;
}

// src/storage/db/budget.ts
var D1_QUERY_BUDGET = { repeats: 10, queries: 900 };
var tallyCtx = contextVar("__d1QueryTally");
function createQueryTally() {
  return { queries: 0, runs: /* @__PURE__ */ new Map() };
}
function queryTallyFor(c) {
  const held = tallyCtx.getOptional(c);
  if (held !== void 0) return held;
  const tally = createQueryTally();
  tallyCtx.set(c, tally);
  return tally;
}
function countQuery(tally, sql2, budget, logger) {
  tally.queries += 1;
  if (tally.queries === budget.queries) logger.warn("d1.request.budget", { reason: "queries", queries: tally.queries });
  if (sql2 === null) return;
  const runs = (tally.runs.get(sql2) ?? 0) + 1;
  tally.runs.set(sql2, runs);
  if (runs === budget.repeats + 1) logger.warn("d1.request.budget", { reason: "repeats", sql: sql2, runs, queries: tally.queries });
}

// src/storage/db/failure.ts
var D1Failure = class extends Error {
  name = "D1Failure";
  kind;
  constraint;
  attempts;
  constructor(kind, message, options = {}) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.constraint = options.constraint;
    this.attempts = options.attempts ?? 1;
  }
};
var CONSTRAINTS = [
  // D1 ends each name at the colon before `SQLITE_CONSTRAINT`, so the colon has to end the capture.
  ["unique", /UNIQUE constraint failed:\s*([^\s:)]+)/i],
  ["not-null", /NOT NULL constraint failed:\s*([^\s:)]+)/i],
  ["check", /CHECK constraint failed:\s*(.+?)(?::\s*SQLITE_\w+|$)/i],
  ["foreign-key", /FOREIGN KEY constraint failed/i]
];
var KINDS = [
  ["timeout", /exceeded timeout/i],
  ["overloaded", /\boverloaded\b/i],
  [
    "limit",
    /memory limit|CPU time limit|statement too long|SQLITE_TOOBIG|too many SQL variables|too many terms in compound SELECT|too many columns|Exceeded maximum DB size|account storage limit|free tier daily row/i
  ],
  [
    "transient",
    /Network connection lost|storage caused object to be reset|reset because its code was updated|Replica disconnected from primary|transient issue on remote node|client disconnected/i
  ]
];
var GUARD_OVERFLOW = /integer overflow/i;
function classifyD1Error(thrown, options = {}) {
  if (thrown instanceof D1Failure) return thrown;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const base = { cause: thrown, ...options.attempts === void 0 ? {} : { attempts: options.attempts } };
  if (options.guarded === true && GUARD_OVERFLOW.test(message)) {
    return new D1Failure("guard", "a guarded statement in this batch wrote no row, so the batch was rolled back", base);
  }
  for (const [rule, pattern] of CONSTRAINTS) {
    const match = pattern.exec(message);
    if (match !== null) return new D1Failure("constraint", message, { ...base, constraint: { rule, name: match[1]?.trim() ?? null } });
  }
  for (const [kind, pattern] of KINDS) if (pattern.test(message)) return new D1Failure(kind, message, base);
  return new D1Failure("unavailable", message, base);
}

// src/storage/db/limits.ts
var D1_LIMITS = { boundParams: 100, statementBytes: 1e5, columns: 100 };

// src/storage/db/retry.ts
var D1_RETRY_POLICY = { attempts: 5, baseDelayMs: 100, maxDelayMs: 2e3 };
function sleepFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function retryWithBackoff(attempt, retryable, policy, clock = {}) {
  const sleep = clock.sleep ?? sleepFor;
  const random = clock.random ?? Math.random;
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt(tried);
    } catch (error) {
      if (tried >= policy.attempts || !retryable(error)) throw error;
      await sleep(Math.floor(random() * Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (tried - 1))));
    }
  }
}

// src/storage/db/sql.ts
var SQL_PLACEHOLDER = "?";
var SQL_FRAGMENT_BRAND = /* @__PURE__ */ Symbol("forge.storage.db.SqlFragment");
function sql(strings, ...values) {
  let text = strings[0] ?? "";
  const params = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const next = strings[i + 1] ?? "";
    if (isSqlFragment(value)) {
      text += value.text + next;
      params.push(...value.params);
    } else {
      text += SQL_PLACEHOLDER + next;
      params.push(value);
    }
  }
  return { [SQL_FRAGMENT_BRAND]: true, text, params };
}
var ROWS_WRITTEN_GUARD = "SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775808) END";
function requireRowsWritten() {
  return { [SQL_FRAGMENT_BRAND]: true, text: ROWS_WRITTEN_GUARD, params: [] };
}
function isSqlFragment(x) {
  return typeof x === "object" && x !== null && x[SQL_FRAGMENT_BRAND] === true;
}

// src/storage/db/client.ts
function writtenOf(meta) {
  return { rowsWritten: meta.changes ?? meta.rows_written ?? 0, ...meta.last_row_id !== void 0 ? { lastRowId: meta.last_row_id } : {} };
}
function costOf(metas) {
  if (!metas.some((meta) => meta.rows_read !== void 0 || meta.rows_written !== void 0 || meta.duration !== void 0)) return void 0;
  const sum = (pick) => metas.reduce((total, meta) => total + (pick(meta) ?? 0), 0);
  return { rowsRead: sum((meta) => meta.rows_read), rowsWritten: sum((meta) => meta.rows_written), durationMs: sum((meta) => meta.duration) };
}
function servedByOf(metas) {
  const placed = metas.find((meta) => meta.served_by_region !== void 0 || meta.served_by_primary !== void 0);
  return placed === void 0 ? void 0 : { region: placed.served_by_region ?? null, primary: placed.served_by_primary ?? null };
}
function totalAttemptsOf(metas) {
  return Math.max(1, ...metas.map((meta) => meta.total_attempts ?? 1));
}
var encoder = new TextEncoder();
function oversized(fragments) {
  for (const [i, fragment] of fragments.entries()) {
    const at = fragments.length === 1 ? "the statement" : `statement ${i + 1}`;
    if (fragment.params.length > D1_LIMITS.boundParams) {
      return new D1Failure(
        "limit",
        `${at} binds ${fragment.params.length} parameters, over D1's ${D1_LIMITS.boundParams} \u2014 bind a list as one JSON array: IN (SELECT value FROM json_each(?))`,
        { attempts: 0 }
      );
    }
    const bytes = encoder.encode(fragment.text).length;
    if (bytes > D1_LIMITS.statementBytes) {
      return new D1Failure("limit", `${at} is ${bytes} bytes, over D1's ${D1_LIMITS.statementBytes}`, { attempts: 0 });
    }
  }
  return null;
}
var SELECT = /^\s*SELECT\b/i;
var PROSE = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
function limitsItself(text) {
  let depth = 0;
  for (const [token] of text.replace(PROSE, (prose) => " ".repeat(prose.length)).matchAll(/[()]|\bLIMIT\b/gi)) {
    if (token === "(") depth += 1;
    else if (token === ")") depth -= 1;
    else if (depth === 0) return true;
  }
  return false;
}
function firstRowOf(fragment) {
  if (!SELECT.test(fragment.text) || limitsItself(fragment.text)) return fragment;
  return { ...fragment, text: `${fragment.text.replace(/[\s;]+$/, "")}
LIMIT 1` };
}
async function call(op, fragments, retry, context, run) {
  const outcome = await dispatch(fragments, retry, context.policy, run);
  if (context.tally !== void 0 && outcome.meta.attempts > 0) {
    countQuery(context.tally, op === "batch" ? null : fragments[0]?.text ?? null, context.budget, context.logger);
  }
  const { cost, servedBy } = outcome.meta;
  const record = {
    op,
    sql: fragments.length === 1 ? fragments[0]?.text : fragments.map((fragment) => fragment.text),
    attempts: outcome.meta.attempts,
    ...outcome.ok ? {} : { failure: outcome.error.kind },
    ...cost,
    ...servedBy === void 0 ? {} : { region: servedBy.region, primary: servedBy.primary }
  };
  const slow = context.slowQueryMs !== void 0 && cost !== void 0 && cost.durationMs > context.slowQueryMs;
  context.logger[slow ? "warn" : "debug"]("d1.query", record);
  return outcome;
}
async function dispatch(fragments, retry, policy, run) {
  const refused = oversized(fragments);
  if (refused !== null) return { ok: false, error: refused, meta: { attempts: 0 } };
  const guarded = fragments.some((f) => f.text.includes(ROWS_WRITTEN_GUARD));
  let dispatches = 0;
  try {
    const answer = await retryWithBackoff(
      () => {
        dispatches += 1;
        return run();
      },
      (thrown) => retry && classifyD1Error(thrown, { guarded }).kind === "transient",
      policy
    );
    const cost = costOf(answer.metas);
    const servedBy = servedByOf(answer.metas);
    const meta = {
      attempts: dispatches - 1 + totalAttemptsOf(answer.metas),
      ...cost === void 0 ? {} : { cost },
      ...servedBy === void 0 ? {} : { servedBy }
    };
    return { ok: true, data: answer.data, meta };
  } catch (thrown) {
    return { ok: false, error: classifyD1Error(thrown, { guarded, attempts: dispatches }), meta: { attempts: dispatches } };
  }
}
function createD1Client(db, options) {
  return clientCounting(db, options, void 0);
}
function clientCounting(db, options, tally) {
  const context = {
    logger: options?.logger ?? createLogger("storage/db", { minLevel: "warn" }),
    policy: { ...D1_RETRY_POLICY, ...options?.retry },
    slowQueryMs: options?.slowQueryMs,
    budget: { ...D1_QUERY_BUDGET, ...options?.queryBudget },
    tally
  };
  return {
    batch(fragments, writeOptions) {
      return call("batch", fragments, writeOptions?.idempotent === true, context, async () => {
        const outcomes = await db.batch(fragments.map((f) => db.prepare(f.text).bind(...f.params)));
        return { data: outcomes.map((res) => ({ results: res.results, ...writtenOf(res.meta) })), metas: outcomes.map((res) => res.meta) };
      });
    },
    execute(fragment, writeOptions) {
      return call("execute", [fragment], writeOptions?.idempotent === true, context, async () => {
        const res = await db.prepare(fragment.text).bind(...fragment.params).run();
        return { data: writtenOf(res.meta), metas: [res.meta] };
      });
    },
    query(fragment) {
      return call("query", [fragment], false, context, async () => {
        const res = await db.prepare(fragment.text).bind(...fragment.params).all();
        return { data: res.results, metas: [res.meta] };
      });
    },
    queryOne(fragment) {
      const sent = firstRowOf(fragment);
      return call("queryOne", [sent], false, context, async () => {
        const res = await db.prepare(sent.text).bind(...sent.params).all();
        return { data: res.results[0] ?? null, metas: [res.meta] };
      });
    }
  };
}

// src/context/pending-headers.ts
var pendingHeadersCtx = contextVar("__pendingResponseHeaders");
function pendingHeaders(context) {
  const existing = pendingHeadersCtx.getOptional(context);
  if (existing) return existing;
  const headers = new Headers();
  pendingHeadersCtx.set(context, headers);
  return headers;
}
function setPendingHeader(context, name, value, options) {
  const headers = pendingHeaders(context);
  if (options?.append) {
    headers.append(name, value);
  } else {
    headers.set(name, value);
  }
}

// src/crypto/primitives/bytes.ts
var TEXT_ENCODER = new TextEncoder();
var TEXT_DECODER = new TextDecoder();
function utf8Encode(s) {
  return TEXT_ENCODER.encode(s);
}
function bytesToHex(bytes) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// src/http/headers.ts
import {
  Accept,
  CacheControl,
  ContentDisposition,
  ContentRange,
  ContentType,
  Cookie,
  IfMatch,
  IfNoneMatch,
  IfRange,
  Range,
  SetCookie,
  Vary
} from "@remix-run/headers";

// src/http/cookie.ts
var COOKIE_ATTRIBUTES_DEFAULT = { path: "/", sameSite: "Lax", httpOnly: true, secure: true };
var STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });

// src/http/method.ts
var SAFE_HTTP_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
function isSafeHttpMethod(method) {
  return SAFE_HTTP_METHODS.has(method.toUpperCase());
}

// src/storage/db/session.ts
var sessionsCtx = contextVar("__d1Sessions");
var BOOKMARK = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{16,64}$/i;
function queryableFor(c, db) {
  return sessionsCtx.getOptional(c)?.get(db) ?? db;
}
function incomingBookmark(request, carrier) {
  const value = "header" in carrier ? request.headers.get(carrier.header) : Cookie.from(request.headers.get("cookie")).get(carrier.cookie);
  return value !== null && BOOKMARK.test(value) ? value : null;
}
function watched(session) {
  let answered = false;
  let failed = false;
  const settle = async (pending) => {
    try {
      const answer = await pending;
      answered = true;
      return answer;
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  const inner = /* @__PURE__ */ new WeakMap();
  const statement = (prepared) => {
    const outer = {
      bind: (...values) => statement(prepared.bind(...values)),
      first: (column) => settle(prepared.first(column)),
      run: () => settle(prepared.run()),
      all: () => settle(prepared.all())
    };
    inner.set(outer, prepared);
    return outer;
  };
  return {
    session: {
      prepare: (sql2) => statement(session.prepare(sql2)),
      batch: (statements) => settle(session.batch(statements.map((s) => inner.get(s) ?? s))),
      getBookmark: () => session.getBookmark()
    },
    refused: () => failed && !answered
  };
}
function d1Sessions(options) {
  return async (context, next) => {
    const c = getAppContext(context);
    const db = options.binding(c);
    if (db?.withSession === void 0) return next();
    const open = db.withSession.bind(db);
    const carrier = options.bookmark;
    const incoming = carrier === void 0 ? null : incomingBookmark(context.request, carrier);
    const write = !isSafeHttpMethod(context.request.method);
    const resumed = write || incoming === null ? null : watched(open(incoming));
    const session = resumed?.session ?? open(write || carrier === void 0 ? "first-primary" : "first-unconstrained");
    const sessions = sessionsCtx.getOptional(context) ?? /* @__PURE__ */ new Map();
    sessions.set(db, session);
    sessionsCtx.set(context, sessions);
    const response = await next();
    if (carrier === void 0) return response;
    if (resumed?.refused() === true) {
      if ("cookie" in carrier)
        setPendingHeader(
          context,
          "set-cookie",
          new SetCookie({ ...COOKIE_ATTRIBUTES_DEFAULT, name: carrier.cookie, value: "", maxAge: 0 }).toString(),
          { append: true }
        );
      return response;
    }
    const bookmark = session.getBookmark();
    if (bookmark === null) return response;
    if ("header" in carrier) setPendingHeader(context, carrier.header, bookmark);
    else if (bookmark !== incoming)
      setPendingHeader(context, "set-cookie", new SetCookie({ ...COOKIE_ATTRIBUTES_DEFAULT, name: carrier.cookie, value: bookmark }).toString(), {
        append: true
      });
    return response;
  };
}

// src/storage/db/bindings.ts
var fallbackLogger = createLogger("storage/db");
function warnAndAbove(logger) {
  return {
    debug: () => {
    },
    info: () => {
    },
    warn: (message, data) => logger.warn(message, data),
    error: (message, data) => logger.error(message, data),
    flush: () => logger.flush(),
    child: (bindings) => warnAndAbove(logger.child(bindings))
  };
}
function d1BindingSpec(name) {
  return { name, methods: ["prepare"], label: "a D1 database binding" };
}
function validateD1Binding(name) {
  const spec = d1BindingSpec(name);
  return validateBindings(bindingSchema(spec.name, spec.methods, spec.label));
}
function resolveD1Client(c, opts) {
  const db = opts.binding(c);
  if (!db) {
    if (opts.required === false) return null;
    throw new Error("D1 database binding not available");
  }
  const client = opts.client?.logger === void 0 ? { ...opts.client, logger: warnAndAbove(loggerFor(c, "storage/db", fallbackLogger)) } : opts.client;
  return clientCounting(queryableFor(c, db), client, queryTallyFor(c));
}

// src/crypto/primitives/digest.ts
async function sha256(data) {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// src/storage/db/schema.ts
var MANAGED_TABLE_PREFIXES = ["_forge_", "sqlite_", "_cf_"];
function isManagedObject(name) {
  return MANAGED_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}
function compareCodePoints(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(j) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 65535 ? 2 : 1;
    j += y > 65535 ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}
function schemaFingerprintInput(objects) {
  return objects.filter((object) => !isManagedObject(object.name)).sort((a, b) => compareCodePoints(a.type, b.type) || compareCodePoints(a.name, b.name)).map((object) => `${object.type}	${object.name}	${object.tblName}	${object.sql ?? ""}`).join("\n");
}
var INVENTORY_SELECT = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name";
function toSchemaObjects(rows) {
  return rows.map((row) => ({
    type: String(row.type ?? ""),
    name: String(row.name ?? ""),
    tblName: String(row.tbl_name ?? ""),
    sql: row.sql === null || row.sql === void 0 ? null : String(row.sql)
  }));
}
var RECORDED_FINGERPRINT_SELECT = "SELECT fingerprint FROM _forge_migrations WHERE fingerprint IS NOT NULL ORDER BY id DESC LIMIT 1";

// src/storage/db/health.ts
var NO_SUCH_TABLE = /no such table/i;
var fallbackLogger2 = createLogger("storage/db");
async function checkSchemaHealth(db) {
  let rows;
  try {
    rows = (await db.prepare(RECORDED_FINGERPRINT_SELECT).all()).results;
  } catch (error) {
    if (NO_SUCH_TABLE.test(error instanceof Error ? error.message : String(error))) {
      return { state: "unavailable", recorded: null, actual: null };
    }
    throw error;
  }
  const inventory = await db.prepare(INVENTORY_SELECT).all();
  const actual = bytesToHex(await sha256(schemaFingerprintInput(toSchemaObjects(inventory.results))));
  const last = rows[0];
  if (last === void 0 || last.fingerprint === null || last.fingerprint === void 0) {
    return { state: "unrecorded", recorded: null, actual };
  }
  const recorded = String(last.fingerprint);
  return { state: recorded === actual ? "match" : "mismatch", recorded, actual };
}
var SCHEMA_RECHECK_MS = 6e4;
function createSchemaHealthMemo(recheckMs) {
  let held;
  return {
    read(db, env, at, reuseMismatch) {
      if (held !== void 0 && held.env === env && at - held.at < recheckMs && (reuseMismatch || held.state !== "mismatch")) {
        return held.health;
      }
      const entry = { env, at, health: checkSchemaHealth(db) };
      held = entry;
      entry.health.then(
        (health) => {
          entry.state = health.state;
        },
        () => {
          if (held === entry) held = void 0;
        }
      );
      return entry.health;
    }
  };
}
function schemaHealthCheckFrom(binding, memo, now) {
  return async (c) => {
    const db = binding(c);
    if (!db) return false;
    return (await memo.read(db, c.env, now(), false)).state !== "mismatch";
  };
}
function schemaHealthCheck(binding, options = {}) {
  return schemaHealthCheckFrom(binding, createSchemaHealthMemo(options.recheckMs ?? SCHEMA_RECHECK_MS), options.now ?? Date.now);
}
function schemaHealthMonitor(options) {
  return schemaHealthMonitorFrom(options, createSchemaHealthMemo(options.recheckMs ?? SCHEMA_RECHECK_MS));
}
function schemaHealthMonitorFrom(options, memo) {
  const recheckMs = options.recheckMs ?? SCHEMA_RECHECK_MS;
  const now = options.now ?? Date.now;
  let cachedEnvRef;
  let observedAt = 0;
  let observed;
  async function observe(c, at) {
    const logger = options.logger ?? loggerFor(c, "storage/db", fallbackLogger2);
    try {
      const db = options.binding(c);
      if (!db) {
        logger.warn("d1.schema.health.skipped", { reason: "binding absent" });
        return;
      }
      try {
        const { state, recorded, actual } = await memo.read(db, c.env, at, true);
        logger[state === "mismatch" || state === "unavailable" ? "warn" : "info"]("d1.schema.health", { state, recorded, actual });
      } catch (error) {
        logger.warn("d1.schema.health.failed", { error: serializeError(error) });
      }
    } finally {
      await logger.flush();
    }
  }
  return async (context, next) => {
    const c = getAppContext(context);
    const at = now();
    if (c.env !== cachedEnvRef || observed === void 0 || at - observedAt >= recheckMs) {
      cachedEnvRef = c.env;
      observedAt = at;
      observed = observe(c, at);
      c.executionCtx.waitUntil(observed);
    }
    return next();
  };
}

// src/storage/db/mount.ts
function defineD1Binding(definition) {
  const { name } = definition;
  const binding = (c) => {
    const value = c.env?.[name];
    return typeof value?.prepare === "function" ? value : void 0;
  };
  const recheck = { recheckMs: definition.recheckMs, now: definition.now };
  const memo = createSchemaHealthMemo(definition.recheckMs ?? SCHEMA_RECHECK_MS);
  const logger = definition.client?.logger ?? definition.logger;
  const clientOptions = { ...definition.client, ...logger === void 0 ? {} : { logger } };
  return {
    spec: d1BindingSpec(name),
    globals: [schemaHealthMonitorFrom({ binding, logger: definition.logger, ...recheck }, memo)],
    health: {
      [name]: (c) => binding(c) !== void 0,
      [`${name}:schema`]: schemaHealthCheckFrom(binding, memo, definition.now ?? Date.now)
    },
    client: (c) => resolveD1Client(c, { binding, client: clientOptions })
  };
}

// src/storage/db/loader.ts
function createRowLoader(db, options) {
  let open;
  const read = async (keys) => {
    const outcome = await db.query(options.select(JSON.stringify([...keys])));
    if (!outcome.ok) return outcome;
    const byKey = /* @__PURE__ */ new Map();
    for (const row of outcome.data) {
      const key = options.keyOf(row);
      if (!byKey.has(key)) byKey.set(key, row);
    }
    return { ok: true, data: byKey, meta: outcome.meta };
  };
  return {
    load(key) {
      if (open === void 0) {
        const keys = /* @__PURE__ */ new Set();
        open = {
          keys,
          answer: Promise.resolve().then(() => {
            open = void 0;
            return read(keys);
          })
        };
      }
      open.keys.add(key);
      return open.answer.then((outcome) => outcome.ok ? { ok: true, data: outcome.data.get(key) ?? null, meta: outcome.meta } : outcome);
    }
  };
}
export {
  D1Failure,
  D1_LIMITS,
  SQL_PLACEHOLDER,
  checkSchemaHealth,
  classifyD1Error,
  compareCodePoints,
  createD1Client,
  createRowLoader,
  createUuidv7,
  createUuidv7Bytes,
  d1Sessions,
  defineD1Binding,
  isSqlFragment,
  requireRowsWritten,
  resolveD1Client,
  schemaHealthCheck,
  schemaHealthMonitor,
  sql,
  uuidFromBytes,
  uuidToBytes,
  uuidv7,
  uuidv7Bytes,
  validateD1Binding
};
