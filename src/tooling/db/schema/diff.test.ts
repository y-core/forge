import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import {
  checkSchemaRenames,
  describeSchemaDiff,
  destructivePlanDigest,
  diffSchemaModels,
  droppedObjectNames,
  parseSchemaRename,
  refuseAddColumn,
  refuseDropColumn,
  schemaDiffIsEmpty,
} from "./diff";
import { assembleSchemaModel } from "./introspect";
import { twoTableRows } from "./introspect.test";
import type { SchemaColumn, SchemaDiff, SchemaModel, SchemaTable, TableChange } from "./types";

const column = (name: string, definitionSource: string, over: Partial<SchemaColumn> = {}): SchemaColumn => ({
  name,
  type: "TEXT",
  notnull: /NOT NULL/i.test(definitionSource),
  defaultExpr: null,
  pk: 0,
  hidden: 0,
  definition: definitionSource.toUpperCase(),
  definitionSource,
  ...over,
});

const table = (name: string, columns: SchemaColumn[], over: Partial<SchemaTable> = {}): SchemaTable => ({
  name,
  columns,
  constraints: [],
  strict: false,
  withoutRowid: false,
  foreignKeys: [],
  sql: `CREATE TABLE ${name} (${columns.map((c) => c.definitionSource).join(", ")})`,
  ...over,
});

const model = (tables: SchemaTable[], over: Partial<SchemaModel> = {}): SchemaModel => ({ tables, indexes: [], triggers: [], views: [], ...over });

describe("parseSchemaRename()", () => {
  it("reads a table rename and a column rename", () => {
    expect(parseSchemaRename("posts:articles")).toEqual({ kind: "table", from: "posts", to: "articles" });
    expect(parseSchemaRename("posts.body:content")).toEqual({ kind: "column", table: "posts", from: "body", to: "content" });
  });

  it("refuses anything else", () => {
    expect(() => parseSchemaRename("posts")).toThrow("--rename posts is not `table:new` or `table.column:new`");
    expect(() => parseSchemaRename("posts")).toThrow(CliError);
  });
});

describe("checkSchemaRenames()", () => {
  const baseline = assembleSchemaModel(twoTableRows());

  it("passes a rename whose source exists", () => {
    expect(checkSchemaRenames(baseline, [parseSchemaRename("posts:articles"), parseSchemaRename("posts.body:content")])).toEqual([]);
  });

  it("refuses one whose source is gone, saying to drop the flag", () => {
    expect(
      checkSchemaRenames(baseline, [parseSchemaRename("articles:posts"), parseSchemaRename("posts.content:body"), parseSchemaRename("nope.a:b")]),
    ).toEqual([
      "--rename articles:posts names no table `articles` in the baseline — already renamed, so drop the flag",
      "--rename posts.content:body names no column `content` on `posts` — already renamed, so drop the flag",
      "--rename nope.a:b names no table `nope` in the baseline",
    ]);
  });
});

describe("refuseAddColumn()", () => {
  const cases: [string, string | null][] = [
    ["nick TEXT", null],
    ["nick TEXT NOT NULL DEFAULT ''", null],
    ["nick TEXT DEFAULT NULL REFERENCES users(id)", null],
    ["id2 INTEGER PRIMARY KEY", "a PRIMARY KEY column cannot be added"],
    ["nick TEXT UNIQUE", "a UNIQUE column cannot be added"],
    ["nick TEXT NOT NULL", "a NOT NULL column with no DEFAULT cannot be added"],
    ["nick TEXT NOT NULL DEFAULT NULL", "a NOT NULL column whose DEFAULT is NULL cannot be added"],
    ["at INTEGER DEFAULT CURRENT_TIMESTAMP", "a column whose DEFAULT is not a constant cannot be added"],
    ["at INTEGER DEFAULT (unixepoch())", "a column whose DEFAULT is not a constant cannot be added"],
    ["owner INTEGER DEFAULT 1 REFERENCES users(id)", "a REFERENCES column whose DEFAULT is not NULL cannot be added"],
    ["total INTEGER GENERATED ALWAYS AS (a + b) STORED", "a STORED generated column cannot be added"],
    ["total INTEGER AS (a + b) VIRTUAL", null],
  ];
  for (const [definition, expected] of cases) {
    it(`${expected === null ? "allows" : "refuses"} \`${definition}\``, () => {
      expect(refuseAddColumn(column("x", definition))).toBe(expected);
    });
  }
});

describe("refuseDropColumn()", () => {
  const baseline = assembleSchemaModel(twoTableRows());
  const posts = baseline.tables[0] as SchemaTable;
  const users = baseline.tables[1] as SchemaTable;

  it("allows a plain column", () => {
    expect(refuseDropColumn(posts, "body", { ...baseline, triggers: [], views: [] })).toBeNull();
  });

  it("refuses a key, an indexed column, a foreign key, a constrained column, and one a trigger or view names", () => {
    expect(refuseDropColumn(posts, "id", baseline)).toBe("a PRIMARY KEY column cannot be dropped");
    expect(refuseDropColumn(posts, "user_id", baseline)).toBe("index posts_user covers it");
    expect(refuseDropColumn(posts, "user_id", { ...baseline, indexes: [] })).toBe("a FOREIGN KEY column cannot be dropped");
    expect(refuseDropColumn(users, "email", baseline)).toBe("a table constraint names it: CHECK(LENGTH(EMAIL) < 254)");
    expect(refuseDropColumn(posts, "body", baseline)).toBe("trigger trg names it");
    expect(refuseDropColumn(users, "id", { ...baseline, triggers: [] })).toBe("a PRIMARY KEY column cannot be dropped");
  });

  it("refuses a generated column", () => {
    const t = table("t", [column("a", "a TEXT"), column("b", "b TEXT AS (a) VIRTUAL", { hidden: 2 })]);
    expect(refuseDropColumn(t, "b", model([t]))).toBe("a generated column cannot be dropped");
  });

  it("refuses a UNIQUE column, whose autoindex covers it", () => {
    const t = table("t", [column("a", "a TEXT"), column("code", "code TEXT UNIQUE")]);
    expect(refuseDropColumn(t, "code", model([t]))).toBe("a UNIQUE column cannot be dropped");
  });
});

describe("diffSchemaModels()", () => {
  const base = model([table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("a", "a TEXT")])]);

  it("is empty for the same schema", () => {
    const diff = diffSchemaModels(base, base);
    expect(schemaDiffIsEmpty(diff)).toBe(true);
    expect(diff.destructive).toEqual([]);
    expect(diff.refusals).toEqual([]);
    expect(diff.dataDependent).toEqual([]);
  });

  it("names each rebuild step whose success depends on the rows already there", () => {
    const id = column("id", "id INTEGER PRIMARY KEY", { pk: 1 });
    const rehearse = "rehearse it on `standby` first";
    const lines = (wanted: SchemaModel) => diffSchemaModels(base, wanted).dataDependent;

    expect(lines(model([table("t", [id, column("a", "a TEXT NOT NULL")])]))).toEqual([
      `t.a becomes NOT NULL — the rebuild copies existing rows as they are, so one holding NULL fails it; ${rehearse}`,
    ]);
    expect(lines(model([table("t", [id, column("a", "a TEXT NOT NULL DEFAULT ''", { defaultExpr: "''" })])]))).toEqual([
      `t.a becomes NOT NULL — the rebuild copies existing rows as they are, so one holding NULL fails it (the DEFAULT does not fill it in); ${rehearse}`,
    ]);
    expect(lines(model([table("t", [id, column("a", "a TEXT CHECK(length(a) < 9)")])]))).toEqual([
      `t.a gains CHECK(LENGTH(A) < 9) — every existing value must already satisfy it; ${rehearse}`,
    ]);
    expect(lines(model([table("t", [id, column("a", "a TEXT")], { constraints: ["CHECK(A <> '')"] })]))).toEqual([
      `t gains CHECK(A <> '') — every existing row must already satisfy it; ${rehearse}`,
    ]);
    expect(lines(model([table("t", [id, column("a", "a TEXT")], { strict: true })]))).toEqual([
      `t becomes STRICT — every existing value must already match its column's declared type; ${rehearse}`,
    ]);

    const strictBase = model([table("t", [id, column("a", "a TEXT")], { strict: true })]);
    const retyped = model([table("t", [id, column("a", "a INTEGER", { type: "INTEGER" })], { strict: true })]);
    expect(diffSchemaModels(strictBase, retyped).dataDependent).toEqual([
      `t.a changes type from TEXT to INTEGER on a STRICT table — every existing value must already be INTEGER; ${rehearse}`,
    ]);
    expect(lines(model([table("t", [id, column("a", "a INTEGER", { type: "INTEGER" })])]))).toEqual([]);
    expect(lines(model([table("t", [id, column("a", "a TEXT"), column("b", "b TEXT DEFAULT 'x'")])]))).toEqual([]);
    expect(lines(model([table("t", [id, column("b", "b TEXT"), column("a", "a TEXT")])]))).toEqual([]);
  });

  it("is empty when only a table's identifier case changed, which SQLite resolves as the same name", () => {
    const renamed = model([table("T", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("a", "a TEXT")])]);
    const diff = diffSchemaModels(base, renamed);

    expect(schemaDiffIsEmpty(diff)).toBe(true);
    expect(diff.destructive).toEqual([]);
  });

  it("is empty when only a column's identifier case changed, rather than dropping and adding it", () => {
    const renamed = model([table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("A", "A TEXT")])]);
    const diff = diffSchemaModels(base, renamed);

    expect(diff.tables).toEqual([]);
    expect(diff.destructive).toEqual([]);
  });

  it("is empty when only an index, trigger or view's identifier case changed", () => {
    const objects = (name: string) => ({
      indexes: [{ name: `idx_${name}`, table: "t", columns: ["a"], unique: false, partial: false, sql: "", normalized: "INDEX" }],
      triggers: [{ name: `trg_${name}`, table: "t", sql: "", normalized: "TRIGGER" }],
      views: [{ name: `v_${name}`, sql: "", normalized: "VIEW" }],
    });
    const tables = [...base.tables];
    const diff = diffSchemaModels(model(tables, objects("x")), model(tables, objects("X")));

    expect(schemaDiffIsEmpty(diff)).toBe(true);
  });

  it("creates and drops tables, and counts a drop as destructive", () => {
    const diff = diffSchemaModels(base, model([table("u", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 })])]));
    expect(diff.tables).toEqual([
      { kind: "create", name: "u" },
      { kind: "drop", name: "t" },
    ]);
    expect(diff.destructive).toEqual(["t: drops the table"]);
    expect(diff.dropDependents).toEqual([]);
    expect(describeSchemaDiff(diff)).toEqual(["create table u", "drop table t"]);
  });

  describe("dropping a table other tables reference", () => {
    const id = column("id", "id INTEGER PRIMARY KEY", { pk: 1 });
    const references = (parent: string) => [{ table: parent, from: ["parent_id"], to: ["id"], onUpdate: "NO ACTION", onDelete: "CASCADE" }];
    const parent = table("parent", [id]);
    const child = table("child", [id, column("parent_id", "parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE")], {
      foreignKeys: references("parent"),
    });
    const other = table("other", [id, column("parent_id", "parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE")], {
      foreignKeys: references("parent"),
    });
    const freed = table("child", [id, column("parent_id", "parent_id INTEGER")]);
    const otherFreed = table("other", [id, column("parent_id", "parent_id INTEGER")]);

    it("names each child in the destructive line and returns it as a drop dependent, so it is rebuilt before the drop", () => {
      const diff = diffSchemaModels(model([parent, child]), model([freed]));
      expect(diff.refusals).toEqual([]);
      expect(diff.dropDependents).toEqual(["child"]);
      expect(diff.destructive).toEqual(["parent: drops the table; child references it and is rebuilt first"]);
      expect(diffSchemaModels(model([parent, child, other]), model([freed, otherFreed])).destructive).toEqual([
        "parent: drops the table; child, other reference it and are rebuilt first",
      ]);
    });

    it("refuses a desired model whose child still references the dropped table", () => {
      const diff = diffSchemaModels(model([parent, child]), model([child]));
      expect(diff.refusals).toEqual(["child references parent, which is dropped — remove the REFERENCES first"]);
    });

    it("counts no dependent when the child is dropped alongside its parent", () => {
      const diff = diffSchemaModels(model([parent, child]), model([]));
      expect(diff.dropDependents).toEqual([]);
      expect(diff.destructive).toEqual(["parent: drops the table", "child: drops the table"]);
    });

    it("matches the child's REFERENCES against the dropped name without regard to case", () => {
      const shouting = table("Child", [id, column("parent_id", "parent_id INTEGER REFERENCES PARENT(id)")], { foreignKeys: references("PARENT") });
      const diff = diffSchemaModels(model([parent, shouting]), model([{ ...freed, name: "Child" }]));
      expect(diff.dropDependents).toEqual(["Child"]);
    });
  });

  it("alters in place when every added column is addable and sits after the existing ones", () => {
    const wanted = model([
      table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("a", "a TEXT"), column("b", "b TEXT DEFAULT 'x'")]),
    ]);
    const diff = diffSchemaModels(base, wanted);
    expect(diff.tables).toEqual([{ kind: "alter", name: "t", added: [column("b", "b TEXT DEFAULT 'x'")], dropped: [] }]);
    expect(describeSchemaDiff(diff)).toEqual(["add column t.b"]);
  });

  it("rebuilds with a named reason when a column changed, moved, was constrained, or the options changed", () => {
    const changed = model([table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("a", "a TEXT NOT NULL DEFAULT ''")])]);
    expect(diffSchemaModels(base, changed).tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["column-changed"], dropped: [] }]);

    const moved = model([table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("b", "b TEXT"), column("a", "a TEXT")])]);
    expect(diffSchemaModels(base, moved).tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["reordered"], dropped: [] }]);

    const constrained = model([table("t", base.tables[0]?.columns as SchemaColumn[], { constraints: ["UNIQUE(A)"] })]);
    expect(diffSchemaModels(base, constrained).tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["constraints-changed"], dropped: [] }]);

    const strict = model([table("t", base.tables[0]?.columns as SchemaColumn[], { strict: true })]);
    expect(diffSchemaModels(base, strict).tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["options-changed"], dropped: [] }]);

    const unique = model([table("t", [...(base.tables[0] as SchemaTable).columns, column("c", "c TEXT UNIQUE")])]);
    expect(diffSchemaModels(base, unique).tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["add-column-unsupported"], dropped: [] }]);
  });

  it("rebuilds rather than DROP COLUMN when SQLite would refuse the drop, and counts the drop as destructive", () => {
    const wanted = model([table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 })])]);
    const withIndex = {
      ...base,
      indexes: [
        {
          name: "t_a",
          table: "t",
          unique: false,
          partial: false,
          columns: ["a"],
          sql: "CREATE INDEX t_a ON t (a)",
          normalized: "CREATE INDEX T_A ON T(A)",
        },
      ],
    };
    const diff = diffSchemaModels(withIndex, wanted);
    expect(diff.tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["drop-column-unsupported"], dropped: ["a"] }]);
    expect(diff.destructive).toEqual(["t: drops column a"]);
    expect(diff.indexes.dropped).toEqual(["t_a"]);
    expect(diffSchemaModels(base, wanted).tables).toEqual([{ kind: "alter", name: "t", added: [], dropped: ["a"] }]);

    const withUnique = model([table("t", [...(base.tables[0] as SchemaTable).columns, column("code", "code TEXT UNIQUE")])]);
    const droppedUnique = diffSchemaModels(withUnique, base);
    expect(droppedUnique.tables).toEqual([{ kind: "rebuild", name: "t", reasons: ["drop-column-unsupported"], dropped: ["code"] }]);
    expect(droppedUnique.destructive).toEqual(["t: drops column code"]);
  });

  it("refuses a NOT NULL column with no DEFAULT on an existing table, whichever route would add it", () => {
    const wanted = model([table("t", [column("id", "id INTEGER PRIMARY KEY", { pk: 1 }), column("a", "a TEXT"), column("b", "b TEXT NOT NULL")])]);
    expect(diffSchemaModels(base, wanted).refusals).toEqual([
      "t.b is NOT NULL with no DEFAULT on a table that already exists — give it a DEFAULT, or add it in a `--custom` migration that fills it",
    ]);
  });

  it("reports created, changed and dropped indexes, triggers and views by name", () => {
    const index = (name: string, normalized: string) => ({
      name,
      table: "t",
      unique: false,
      partial: false,
      columns: [],
      sql: normalized,
      normalized,
    });
    const diff = diffSchemaModels(
      { ...base, indexes: [index("i1", "A"), index("i2", "B")], views: [{ name: "v", sql: "x", normalized: "X" }] },
      { ...base, indexes: [index("i2", "C"), index("i3", "D")], views: [{ name: "v", sql: "x", normalized: "X" }] },
    );
    expect(diff.indexes).toEqual({ created: ["i3"], dropped: ["i1"], changed: ["i2"] });
    expect(diff.views).toEqual({ created: [], dropped: [], changed: [] });
    expect(describeSchemaDiff(diff)).toEqual(["create index i3", "replace index i2", "drop index i1"]);
  });
});

describe("destructivePlanDigest()", () => {
  const NO_NAMED = { created: [], dropped: [], changed: [] };
  const planOf = (tables: readonly TableChange[]): SchemaDiff => ({
    tables,
    indexes: NO_NAMED,
    triggers: NO_NAMED,
    views: NO_NAMED,
    destructive: [],
    refusals: [],
    dataDependent: [],
    dropDependents: [],
  });
  const DROP_USERS: TableChange = { kind: "alter", name: "users", added: [], dropped: ["nickname"] };
  const DROP_AUDIT: TableChange = { kind: "drop", name: "audit" };

  it("is twelve lowercase hex characters, and changes with a line or with the order", () => {
    const one = destructivePlanDigest(planOf([DROP_USERS, DROP_AUDIT]));
    expect(one).toMatch(/^[0-9a-f]{12}$/);
    expect(destructivePlanDigest(planOf([DROP_USERS, DROP_AUDIT]))).toBe(one);
    expect(destructivePlanDigest(planOf([DROP_USERS, DROP_AUDIT, { kind: "drop", name: "x" }]))).not.toBe(one);
    expect(destructivePlanDigest(planOf([DROP_AUDIT, DROP_USERS]))).not.toBe(one);
  });

  it("changes when a non-destructive change joins the plan, so an approval cannot carry to a different one", () => {
    const one = destructivePlanDigest(planOf([DROP_AUDIT]));
    const withCreate = destructivePlanDigest({ ...planOf([DROP_AUDIT, { kind: "create", name: "notes" }]) });
    const withIndex = destructivePlanDigest({ ...planOf([DROP_AUDIT]), indexes: { created: ["notes_body"], dropped: [], changed: [] } });

    expect(withCreate).not.toBe(one);
    expect(withIndex).not.toBe(one);
    expect(withIndex).not.toBe(withCreate);
  });

  it("changes with the causes and holds still without them, so an approval covers why the plan drops what it drops", () => {
    const plan = planOf([DROP_AUDIT]);
    const cause = "audit was declared by node_modules/acme/schema.sql";

    expect(destructivePlanDigest(plan, [])).toBe(destructivePlanDigest(plan));
    expect(destructivePlanDigest(plan, [cause])).toBe(destructivePlanDigest(plan, [cause]));
    expect(destructivePlanDigest(plan, [cause])).not.toBe(destructivePlanDigest(plan));
    expect(destructivePlanDigest(plan, [cause])).not.toBe(destructivePlanDigest(plan, [`${cause} — nothing declares it now`]));
  });
});

describe("droppedObjectNames()", () => {
  const NO_NAMED = { created: [], dropped: [], changed: [] };

  it("is every dropped table, index, trigger and view, and no dropped column", () => {
    const diff: SchemaDiff = {
      tables: [
        { kind: "drop", name: "audit" },
        { kind: "create", name: "notes" },
        { kind: "alter", name: "users", added: [], dropped: ["nickname"] },
      ],
      indexes: { ...NO_NAMED, dropped: ["audit_at"] },
      triggers: { ...NO_NAMED, dropped: ["audit_ins"] },
      views: { ...NO_NAMED, dropped: ["audit_recent"] },
      destructive: [],
      refusals: [],
      dataDependent: [],
      dropDependents: [],
    };

    expect(droppedObjectNames(diff)).toEqual(["audit", "audit_at", "audit_ins", "audit_recent"]);
  });

  it("is empty for a diff that drops nothing outright", () => {
    expect(
      droppedObjectNames({
        tables: [{ kind: "create", name: "notes" }],
        indexes: NO_NAMED,
        triggers: NO_NAMED,
        views: NO_NAMED,
        destructive: [],
        refusals: [],
        dataDependent: [],
        dropDependents: [],
      }),
    ).toEqual([]);
  });
});
