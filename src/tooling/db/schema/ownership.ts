import { CliError } from "../../cli/errors";
import { sqlIdentifierKey } from "./normalize";
import type { OwnershipClaim, SchemaModel } from "./types";

/** The names one declared schema owns, keyed as SQLite resolves a name: everything its text declares. @internal */
export function ownedNames(claim: OwnershipClaim): Set<string> {
  return new Set((claim.declared ?? []).map((object) => sqlIdentifierKey(object.name)));
}

/** Refuses a name two declared schemas both hold, and an index or trigger on a table another file declares. @internal */
export function assignOwnership(claims: readonly OwnershipClaim[], desired: SchemaModel): void {
  const owner = new Map<string, string>();
  for (const claim of claims) {
    for (const name of ownedNames(claim)) {
      const other = owner.get(name);
      if (other !== undefined && other !== claim.source) {
        throw new CliError(
          "invalid-args",
          `\`${name}\` is declared by both ${other} and ${claim.source} — one object has one declaration, so remove it from one`,
        );
      }
      owner.set(name, claim.source);
    }
  }

  const dependents = [
    ...desired.indexes.map((index) => ({ type: "index", name: index.name, table: index.table })),
    ...desired.triggers.map((trigger) => ({ type: "trigger", name: trigger.name, table: trigger.table })),
  ];
  for (const object of dependents) {
    const own = owner.get(sqlIdentifierKey(object.name));
    const tableOwner = owner.get(sqlIdentifierKey(object.table));
    if (own === undefined || tableOwner === undefined || own === tableOwner) continue;
    throw new CliError(
      "invalid-args",
      `${own} declares ${object.type} \`${object.name}\` on \`${object.table}\`, which ${tableOwner} declares — an ${object.type} belongs with its table, so declare it there`,
    );
  }
}
