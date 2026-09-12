import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { scanSql } from "../schema/normalize";
import type { DbIo, DeclaredPath, Place, Seed, SeedFile } from "../types";

const PLACES: readonly Place[] = ["local", "standby", "remote", "preview"];
const PLACES_LINE = /^--\s*forge:places\s+(.+?)\s*$/;

/** The places a seed's first line restricts it to, or null when it carries no `-- forge:places` line. @internal */
export function parseSeedPlaces(rawSql: string, path: string): Place[] | null {
  const first = rawSql.split("\n", 1)[0] ?? "";
  const match = PLACES_LINE.exec(first);
  if (match === null) return null;
  const names = (match[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const places: Place[] = [];
  for (const name of names) {
    if (!(PLACES as readonly string[]).includes(name)) {
      throw new CliError(
        "invalid-args",
        `${path} names \`${name}\` in its forge:places line, which is not a place — the places are ${PLACES.join(", ")}`,
      );
    }
    places.push(name as Place);
  }
  if (places.length === 0)
    throw new CliError("invalid-args", `${path} has a forge:places line naming no place — remove the line, or name one of ${PLACES.join(", ")}`);
  return places;
}

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** What a value may be where the SQL quotes nothing around it: one identifier-like token, or a number. @internal */
export const SEED_BARE_VALUE = /^(?:[A-Za-z_][A-Za-z0-9_.]*|-?\d+(?:\.\d+)?)$/;

function resolve(name: string, fallback: string | undefined, env: Record<string, string | undefined>): string {
  const value = env[name];
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new CliError("invalid-args", `${name} is not set and the seed gives it no default — export it, or write \${${name}:-default} in the file`);
}

function literalSpans(sql: string): { start: number; end: number }[] {
  return scanSql(sql)
    .filter((token) => token.kind === "string")
    .map((token) => ({ start: token.start, end: token.end }));
}

/** Substitutes `${VAR}` and `${VAR:-default}`: inside a string literal the value is quoted, outside one only an identifier-like token or a number is accepted. @internal */
export function expandSeedEnv(sql: string, env: Record<string, string | undefined>): string {
  const spans = literalSpans(sql);
  return sql.replace(VARIABLE, (match: string, name: string, fallback: string | undefined, offset: number) => {
    const value = resolve(name, fallback, env);
    if (value.includes("\0")) {
      throw new CliError("invalid-args", `${name} holds a NUL byte, which no SQL text can carry — a seed will not splice one into a statement`);
    }
    const inLiteral = spans.some((span) => offset >= span.start && offset + match.length <= span.end);
    if (inLiteral) return value.replaceAll("'", "''");
    // An empty value writes nothing, so it can break the statement's syntax but can never add to it.
    if (value === "" || SEED_BARE_VALUE.test(value)) return value;
    throw new CliError(
      "invalid-args",
      `${name} is substituted outside a SQL string literal, where its value is the SQL itself, and \`${value.slice(0, 24)}\` is neither an identifier-like token nor a number — quote the placeholder in the seed ('\${${name}}'), or set a value matching [A-Za-z_][A-Za-z0-9_.]* or -?\\d+(\\.\\d+)?`,
    );
  });
}

/** Parses one seed file, keeping the text as written and hashing it, so a different environment is not a changed seed. @internal */
export function parseSeed(source: string, name: string, path: string, rawSql: string): Seed {
  return {
    source,
    name: name.endsWith(".sql") ? name.slice(0, -".sql".length) : name,
    path,
    sha256: sha256(rawSql),
    sql: rawSql,
    places: parseSeedPlaces(rawSql, path),
  };
}

/** Reads every `.sql` file in a seeds directory, in name order. An absent directory is an empty list. @internal */
export function readSeedFiles(io: DbIo, dir: string): SeedFile[] {
  if (!io.exists(dir)) return [];
  return io
    .readDir(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, path: join(dir, name), sql: io.readText(join(dir, name)) }));
}

/** Reads and parses one declared seeds directory, expanding nothing — the environment is `seed apply`'s concern. @internal */
export function discoverSeeds(io: DbIo, source: DeclaredPath): Seed[] {
  return readSeedFiles(io, source.path).map((file) => parseSeed(source.declared, file.name, file.path, file.sql));
}
