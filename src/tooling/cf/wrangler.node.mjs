// Generated from src/tooling/cf/wrangler.ts by `bun run gen:bundles` — do not edit.

// src/tooling/cf/config/parse.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// src/validation/validation.ts
import * as v from "valibot";

// src/tooling/cli/jsonc.ts
function formatPath(path) {
  return path.reduce((acc, seg) => typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg), "");
}
var isWs = (c) => c === " " || c === "	" || c === "\n" || c === "\r";
function skipTrivia(src, i) {
  const len = src.length;
  while (i < len) {
    if (isWs(src[i])) {
      i++;
      continue;
    }
    const afterComment = scanComment(src, i);
    if (afterComment === void 0) break;
    i = afterComment;
  }
  return i;
}
function scanComment(src, i) {
  const len = src.length;
  if (src[i] !== "/") return void 0;
  if (src[i + 1] === "/") {
    let j = i + 2;
    while (j < len && src[j] !== "\n") j++;
    return j;
  }
  if (src[i + 1] === "*") {
    let j = i + 2;
    while (j < len) {
      if (src[j] === "*" && src[j + 1] === "/") return j + 2;
      j++;
    }
    return j;
  }
  return void 0;
}
function scanString(src, i) {
  const len = src.length;
  i++;
  while (i < len) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    i++;
  }
  return i;
}
function isTrailingComma(src, i) {
  const next = src[skipTrivia(src, i + 1)];
  return next === "}" || next === "]";
}
function stripJsonc(src) {
  let out = "";
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === '"') {
      const end = scanString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      i = skipTrivia(src, i);
      continue;
    }
    if (ch === "," && isTrailingComma(src, i)) {
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// src/tooling/cf/schema.ts
function jsonTable(schema, message = "must be an object") {
  return v.pipe(
    v.unknown(),
    v.check((value) => !Array.isArray(value), message),
    schema
  );
}

// src/tooling/cf/config/parse.ts
var MISSING_NAME_MESSAGE = 'wrangler config must define a string "name"';
var D1DatabaseSchema = v.looseObject({
  binding: v.string(),
  database_name: v.optional(v.string()),
  database_id: v.optional(v.string()),
  preview_database_id: v.optional(v.string()),
  migrations_dir: v.optional(v.string()),
  migrations_pattern: v.optional(v.string()),
  migrations_table: v.optional(v.string())
});
var ENVIRONMENT_ENTRIES = {
  r2_buckets: v.optional(v.array(v.looseObject({ binding: v.string() }))),
  workflows: v.optional(
    v.array(v.looseObject({ name: v.string(), binding: v.string(), class_name: v.string(), script_name: v.optional(v.string()) }))
  ),
  name: v.optional(v.string()),
  main: v.optional(v.string()),
  compatibility_date: v.optional(v.string()),
  compatibility_flags: v.optional(v.array(v.string())),
  account_id: v.optional(v.string()),
  assets: v.optional(
    jsonTable(
      v.looseObject({
        directory: v.optional(v.string()),
        binding: v.optional(v.string()),
        run_worker_first: v.optional(v.union([v.boolean(), v.array(v.string())]))
      }),
      "must be a table"
    )
  ),
  workers_dev: v.optional(v.boolean()),
  preview_urls: v.optional(v.boolean()),
  routes: v.optional(v.array(v.unknown())),
  d1_databases: v.optional(v.array(D1DatabaseSchema))
};
function hasOwnProto(value) {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "__proto__");
}
var EnvironmentSchema = jsonTable(v.looseObject(ENVIRONMENT_ENTRIES), "must be an environment table");
var WranglerConfigSchema = v.looseObject(
  {
    ...ENVIRONMENT_ENTRIES,
    name: v.string(MISSING_NAME_MESSAGE),
    pages_build_output_dir: v.optional(v.string()),
    env: v.optional(
      v.pipe(
        v.unknown(),
        v.check((envs) => !Array.isArray(envs) && !hasOwnProto(envs), "must be a table of named environments"),
        v.record(v.string(), EnvironmentSchema)
      )
    ),
    vars: v.optional(v.record(v.string(), v.unknown())),
    kv_namespaces: v.optional(v.array(v.looseObject({ binding: v.string() }))),
    queues: v.optional(
      v.looseObject({
        producers: v.optional(v.array(v.looseObject({ binding: v.string() }))),
        consumers: v.optional(v.array(v.looseObject({ queue: v.string() })))
      })
    )
  },
  (issue) => issue.expected === '"name"' ? MISSING_NAME_MESSAGE : issue.message
);
function describeIssues(issues) {
  return issues.map((issue) => {
    const keys = (issue.path ?? []).map((item) => item.key);
    return `${formatPath(keys) || "(root)"}: ${issue.message}`;
  }).join("; ");
}
function decodeWranglerSource(source, origin) {
  try {
    return JSON.parse(stripJsonc(source));
  } catch (thrown) {
    throw new Error(`malformed wrangler config at ${origin}: invalid JSON \u2014 ${thrown.message}`, { cause: thrown });
  }
}
function validateWranglerConfig(tree, origin) {
  const result = v.safeParse(WranglerConfigSchema, tree);
  if (!result.success) throw new Error(`malformed wrangler config at ${origin}: ${describeIssues(result.issues)}`);
  return tree;
}
function loadWranglerConfig(configPath) {
  const abs = resolve(configPath);
  const source = readFileSync(abs, "utf-8");
  return { path: abs, source, config: validateWranglerConfig(decodeWranglerSource(source, abs), abs) };
}
function parseWranglerConfig(configPath) {
  return loadWranglerConfig(configPath).config;
}
export {
  parseWranglerConfig
};
