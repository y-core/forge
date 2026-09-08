import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkReadmeExports, discoverReadmes } from "./readme-exports";

let root: string;

const BARREL = 'export { Form } from "./form";\nexport type { FormProps } from "./form";\n';

function readme(body: string): void {
  writeFileSync(join(root, "src/ui/README.md"), body);
}

function barrel(source: string): void {
  writeFileSync(join(root, "src/ui/core/mod.ts"), source);
}

const section = (rows: string, tail = ""): string =>
  [
    "## `@y-core/forge/ui/core`",
    "",
    "> Import path: `@y-core/forge/ui/core` → `src/ui/core/mod.ts`",
    "",
    "### Exports",
    "",
    "| Export | Kind | Description |",
    "| ------ | ---- | ----------- |",
    rows,
    "",
    tail,
    "",
  ].join("\n");

const run = (exempt?: readonly string[]) => checkReadmeExports({ root, readmes: ["src/ui/README.md"], ...(exempt ? { exempt } : {}) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-readme-exports-"));
  mkdirSync(join(root, "src/ui/core"), { recursive: true });
  barrel(BARREL);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkReadmeExports() — a table held against its barrel", () => {
  it("passes when every value has a row and every type has a `**Types:**` mention", () => {
    readme(section("| `Form` | component | A form. |", "**Types:** `FormProps`."));
    expect(run()).toEqual({
      ok: true,
      findings: [],
      summary: "README exports: 1 subpath tables across 1 READMEs agree with their barrels, 0 exempt",
    });
  });

  it("passes when a type is documented as a table row instead", () => {
    readme(section("| `Form` | component | A form. |\n| `FormProps` | type | Its props. |"));
    expect(run().ok).toBe(true);
  });

  it("fails naming an undocumented value at the `### Exports` heading", () => {
    readme(section("| `FormProps` | type | Its props. |"));
    expect(run()).toEqual({
      ok: false,
      findings: [
        {
          level: "fail",
          message: "`src/ui/core/mod.ts` exports the value `Form`, which the `./ui/core` table does not name",
          file: "src/ui/README.md",
          line: 5,
        },
      ],
      summary: "README exports: 1 subpath tables across 1 READMEs agree with their barrels, 0 exempt",
    });
  });

  it("calls an undocumented type a type, so the reader knows a `**Types:**` mention would do", () => {
    readme(section("| `Form` | component | A form. |"));
    expect(run().findings).toEqual([
      {
        level: "fail",
        message: "`src/ui/core/mod.ts` exports the type `FormProps`, which the `./ui/core` table does not name",
        file: "src/ui/README.md",
        line: 5,
      },
    ]);
  });

  it("fails at the row's own line when a row names a symbol the barrel does not export", () => {
    readme(section("| `Form` | component | A form. |\n| `Fieldset` | component | Renamed away. |", "**Types:** `FormProps`."));
    expect(run().findings).toEqual([
      {
        level: "fail",
        message: "the `./ui/core` table names `Fieldset`, which `src/ui/core/mod.ts` does not export",
        file: "src/ui/README.md",
        line: 10,
      },
    ]);
  });

  it("fails a section that carries the anchor and documents no exports at all", () => {
    readme(["## `@y-core/forge/ui/core`", "", "> Import path: `@y-core/forge/ui/core` → `src/ui/core/mod.ts`", "", "Prose only.", ""].join("\n"));
    expect(run().findings).toEqual([
      {
        level: "fail",
        message: "`./ui/core` documents no exports — add an `### Exports` table, or exempt the subpath with a reason",
        file: "src/ui/README.md",
        line: 3,
      },
    ]);
  });

  it("skips an exempt subpath rather than requiring a table of it", () => {
    readme(["## `@y-core/forge/ui/core`", "", "> Import path: `@y-core/forge/ui/core` → `src/ui/core/mod.ts`", "", "Prose only.", ""].join("\n"));
    expect(run(["./ui/core"])).toEqual({
      ok: true,
      findings: [],
      summary: "README exports: 0 subpath tables across 1 READMEs agree with their barrels, 1 exempt",
    });
  });

  it("fails an anchor pointing at a barrel that does not exist", () => {
    rmSync(join(root, "src/ui/core/mod.ts"));
    readme(section("| `Form` | component | A form. |", "**Types:** `FormProps`."));
    expect(run().findings).toEqual([
      { level: "fail", message: "`./ui/core` points at `src/ui/core/mod.ts`, which does not exist", file: "src/ui/README.md", line: 3 },
    ]);
  });

  it("fails when a listed README is missing", () => {
    expect(checkReadmeExports({ root, readmes: ["src/ui/MISSING.md"] })).toEqual({
      ok: false,
      findings: [{ level: "fail", message: "`src/ui/MISSING.md` not found", file: "src/ui/MISSING.md" }],
      summary: "README exports: 0 subpath tables across 1 READMEs agree with their barrels, 0 exempt",
    });
  });

  it("checks every listed README, and names the one a finding came from", () => {
    readme(section("| `Form` | component | A form. |", "**Types:** `FormProps`."));
    mkdirSync(join(root, "src/storage/db"), { recursive: true });
    writeFileSync(join(root, "src/storage/db/mod.ts"), 'export { sql } from "./sql";\n');
    writeFileSync(
      join(root, "src/storage/README.md"),
      [
        "## `@y-core/forge/storage/db`",
        "",
        "> Import path: `@y-core/forge/storage/db` → `src/storage/db/mod.ts`",
        "",
        "### Exports",
        "",
        "| Export | Kind | Description |",
        "| ------ | ---- | ----------- |",
        "",
      ].join("\n"),
    );
    expect(checkReadmeExports({ root, readmes: ["src/ui/README.md", "src/storage/README.md"] })).toEqual({
      ok: false,
      findings: [
        {
          level: "fail",
          message: "`src/storage/db/mod.ts` exports the value `sql`, which the `./storage/db` table does not name",
          file: "src/storage/README.md",
          line: 5,
        },
      ],
      summary: "README exports: 2 subpath tables across 2 READMEs agree with their barrels, 0 exempt",
    });
  });

  it("checks nothing in a README that adopts no anchor", () => {
    readme("# Title\n\nNo import-path line here.\n");
    expect(run()).toEqual({
      ok: true,
      findings: [],
      summary: "README exports: 0 subpath tables across 1 READMEs agree with their barrels, 0 exempt",
    });
  });
});

describe("checkReadmeExports() — the READMEs it finds when none is configured", () => {
  it("discovers a README carrying the anchor", () => {
    readme(section("| `Form` | component | A form. |", "**Types:** `FormProps`."));
    expect(discoverReadmes(root, ["src"])).toEqual(["src/ui/README.md"]);
  });

  it("ignores a README that carries no anchor", () => {
    readme("# Title\n\nNo import-path line here.\n");
    expect(discoverReadmes(root, ["src"])).toEqual([]);
  });

  it("holds every discovered README, so an undocumented export still fails", () => {
    readme(section("| `FormProps` | type | Its props. |"));
    expect(checkReadmeExports({ root, sources: ["src"] }).findings.map((finding) => finding.message)).toEqual([
      "`src/ui/core/mod.ts` exports the value `Form`, which the `./ui/core` table does not name",
    ]);
  });

  it("lets an explicit `readmes` win over discovery", () => {
    readme(section("| `FormProps` | type | Its props. |"));
    expect(checkReadmeExports({ root, readmes: [], sources: ["src"] }).ok).toBe(false);
  });

  it("refuses a tree where discovery finds no marked README, rather than reporting a green gate", () => {
    readme("# Title\n\nNo import-path line here.\n");
    const result = checkReadmeExports({ root, sources: ["src"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "no README carries a `> Import path:` anchor — refusing to report a green readme-exports gate that held nothing",
    ]);
  });
});
