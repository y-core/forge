import { createD1Client } from "../../storage/db/client";
import type { D1Client } from "../../storage/db/types";
import { fakeAuthD1 } from "../../testing/auth-fakes";
import { squashSql } from "./events.fixture";
import { createAuthSessionStore } from "./sessions";

/** The token hash of the session a factor change is made from. @internal */
export const ACTING_SESSION = new Uint8Array(32).fill(1);

/** The token hash of another session the same user holds elsewhere. @internal */
export const OTHER_SESSION = new Uint8Array(32).fill(2);

/** One user signed in under `ACTING_SESSION` and `OTHER_SESSION` over `fakeAuthD1`, with `landed` answering the writes that fake declines, and which of them still resolve. @internal */
export async function seededSessions(
  userId: string,
  landed: (sql: string) => number | null,
): Promise<{ readonly client: D1Client; readonly live: () => Promise<readonly [acting: boolean, other: boolean]> }> {
  const client = createD1Client(fakeAuthD1([{ id: userId, email: "ada@example.test" }], { rowsWritten: (sql) => landed(squashSql(sql)) }) as never);
  const sessions = createAuthSessionStore(client);
  for (const tokenHash of [ACTING_SESSION, OTHER_SESSION]) {
    await sessions.create({ tokenHash, userId, signedInAt: 1_000, signedInWith: "email-otp" }, null);
  }
  const resolves = async (tokenHash: Uint8Array<ArrayBuffer>) => {
    const found = await sessions.resolve(tokenHash, 2_000);
    return found.ok && found.data !== null;
  };
  return { client, live: async () => [await resolves(ACTING_SESSION), await resolves(OTHER_SESSION)] as const };
}
