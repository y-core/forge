import { describe, expect, it } from "bun:test";

import { fakeD1 } from "../../testing/fakes";
import { createD1Client } from "./client";
import { createRowLoader } from "./loader";
import { sql } from "./sql";

type User = { id: number; email: string };

const USERS: User[] = [
  { id: 1, email: "a@example.com" },
  { id: 2, email: "b@example.com" },
  { id: 3, email: "c@example.com" },
];

function usersDb() {
  return fakeD1((_sql, params) => {
    const wanted = JSON.parse(String(params[0])) as number[];
    return USERS.filter((user) => wanted.includes(user.id));
  });
}

const byId = {
  select: (keysJson: string) => sql`SELECT id, email FROM users WHERE id IN (SELECT value FROM json_each(${keysJson}))`,
  keyOf: (row: User) => row.id,
};

describe("createRowLoader()", () => {
  it("answers every load in one tick from one query, each with its own row or null", async () => {
    const db = usersDb();
    const loader = createRowLoader(createD1Client(db), byId);
    const answers = await Promise.all([3, 1, 9].map((id) => loader.load(id)));
    expect([answers.map((answer) => (answer.ok ? answer.data : answer.error.kind)), db.calls]).toEqual([
      [USERS[2], USERS[0], null],
      [{ sql: "SELECT id, email FROM users WHERE id IN (SELECT value FROM json_each(?))", params: ["[3,1,9]"] }],
    ]);
  });

  it("binds a key asked for twice once, and answers both callers", async () => {
    const db = usersDb();
    const loader = createRowLoader(createD1Client(db), byId);
    const [first, second] = await Promise.all([loader.load(2), loader.load(2)]);
    expect([first?.ok && first.data, second?.ok && second.data, db.calls.map((call) => call.params)]).toEqual([USERS[1], USERS[1], [["[2]"]]]);
  });

  it("collects loads made after an earlier batch answered into the next statement", async () => {
    const db = usersDb();
    const loader = createRowLoader(createD1Client(db), byId);
    await Promise.all(
      [1, 2].map(async (id) => {
        await loader.load(id);
        return loader.load(id + 1);
      }),
    );
    expect(db.calls.map((call) => call.params)).toEqual([["[1,2]"], ["[2,3]"]]);
  });

  it("hands every pending load the same D1 failure", async () => {
    const db = fakeD1(() => [], { failOn: () => new Error("D1_ERROR: no such table: users") });
    const loader = createRowLoader(createD1Client(db), byId);
    const answers = await Promise.all([1, 2].map((id) => loader.load(id)));
    expect(answers.map((answer) => (answer.ok ? answer.data : answer.error.message))).toEqual([
      "D1_ERROR: no such table: users",
      "D1_ERROR: no such table: users",
    ]);
  });

  it("rejects every pending load when select throws", async () => {
    const loader = createRowLoader(createD1Client(usersDb()), {
      ...byId,
      select: () => {
        throw new Error("no statement");
      },
    });
    const settled = await Promise.allSettled([loader.load(1), loader.load(2)]);
    expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  });
});
