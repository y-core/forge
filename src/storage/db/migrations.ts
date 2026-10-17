/** Where an app keeps its migrations and its composed snapshot unless `config/db.ts` says otherwise. @internal */
export const DB_LAYOUT = { migrations: "config/db/migrations", snapshot: "config/db/schema.snapshot.json" } as const;

// wrangler's own shape: a number, an underscore, a name, `.sql`.
const MIGRATION_FILE = /^(\d+)_(.+)\.sql$/;

/** True for a file name wrangler would apply as a migration. @internal */
export function isMigrationFileName(name: string): boolean {
  return MIGRATION_FILE.test(name);
}

/** Puts migration files in wrangler's apply order — by number, not by name — refusing a name wrangler would not apply and a number used twice. @internal */
export function inMigrationOrder<T extends { readonly name: string }>(files: readonly T[]): (T & { readonly version: number })[] {
  const numbered = files.map((file) => {
    const match = MIGRATION_FILE.exec(file.name);
    if (match === null) throw new Error(`${file.name} is not a migration file name — wrangler applies <NNNN>_<name>.sql and nothing else`);
    return { file, version: Number(match[1]), digits: match[1] ?? "" };
  });
  numbered.sort((a, b) => a.version - b.version || (a.file.name < b.file.name ? -1 : a.file.name > b.file.name ? 1 : 0));
  const seen = new Map<number, string>();
  return numbered.map(({ file, version, digits }) => {
    const other = seen.get(version);
    if (other !== undefined) throw new Error(`${file.name} and ${other} share the number ${digits} — renumber one so they apply in one order`);
    seen.set(version, file.name);
    return { ...file, version };
  });
}
