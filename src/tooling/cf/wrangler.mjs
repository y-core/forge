// Generated from src/tooling/cf/wrangler.ts by `bun run gen:bundles` — do not edit.

// src/tooling/cf/config/parse.ts
import { chmodSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// src/validation/validation.ts
import * as v from "valibot";

// src/tooling/cli/jsonc.ts
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

// src/tooling/cf/config/parse.ts
var MISSING_NAME_MESSAGE = 'wrangler config must define a string "name"';
var WranglerConfigSchema = v.looseObject(
  {
    name: v.string(MISSING_NAME_MESSAGE),
    vars: v.optional(v.record(v.string(), v.unknown())),
    kv_namespaces: v.optional(v.array(v.looseObject({ binding: v.string() }))),
    d1_databases: v.optional(v.array(v.looseObject({ binding: v.string() }))),
    r2_buckets: v.optional(v.array(v.looseObject({ binding: v.string() }))),
    queues: v.optional(
      v.looseObject({
        producers: v.optional(v.array(v.looseObject({ binding: v.string() }))),
        consumers: v.optional(v.array(v.looseObject({ queue: v.string() })))
      })
    )
  },
  (issue) => issue.expected === '"name"' ? MISSING_NAME_MESSAGE : issue.message
);
function loadWranglerConfig(configPath) {
  const abs = resolve(configPath);
  const source = readFileSync(abs, "utf-8");
  const json = stripJsonc(source);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (thrown) {
    throw new Error(`malformed wrangler config at ${abs}: invalid JSON \u2014 ${thrown.message}`, { cause: thrown });
  }
  const result = v.safeParse(WranglerConfigSchema, parsed);
  if (!result.success) {
    const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`malformed wrangler config at ${abs}: ${detail}`);
  }
  return { path: abs, source, config: parsed };
}
function parseWranglerConfig(configPath) {
  return loadWranglerConfig(configPath).config;
}
export {
  parseWranglerConfig
};
