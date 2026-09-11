import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { createIdentityLinkStore } from "./identity-links";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => []): [D1Client, FakeDb] {
  const db = fakeD1(rows);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

describe("createIdentityLinkStore", () => {
  it("finds a link by provider and subject together", async () => {
    const [client, db] = clientOf(() => []);
    expect(await createIdentityLinkStore(client).find("github", "42")).toEqual({ ok: true, data: null });
    expect(db.calls[0]?.params).toEqual(["github", "42"]);
  });

  it("returns the link it wrote", async () => {
    const [client] = clientOf();
    const linked = await createIdentityLinkStore(client).link({ userId: USER_ID, provider: "github", subject: "42" }, 3_000);
    expect(linked.ok && linked.data).toEqual({
      id: linked.ok ? linked.data.id : "",
      userId: USER_ID,
      provider: "github",
      subject: "42",
      createdAt: 3_000,
      updatedAt: 3_000,
    });
  });

  // The owner is in the statement, matching `factors.remove` and `credentials.removeForUser`: a
  // link id belonging to somebody else must remove no row, and not rest on the caller remembering.
  it("scopes the delete to the owner, so a stranger's link id unlinks nothing", async () => {
    const [client, db] = clientOf(() => []);
    await createIdentityLinkStore(client).unlink(OTHER_ID, USER_ID);
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe("DELETE FROM auth_identity_links WHERE id = ? AND user_id = ?");
    expect(db.calls[0]?.params).toEqual([uuidToBytes(OTHER_ID), uuidToBytes(USER_ID)]);
  });
});
