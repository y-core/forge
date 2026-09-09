import { describe, expect, it } from "bun:test";

import { createFactorStore } from "../auth/stores/factors";
import { createUserStore } from "../auth/stores/users";
import { createD1Client } from "../storage/db/client";
import { fakeAuthD1 } from "./auth-fakes";

const ADA = "018f0000-0000-7000-8000-000000000001";
const GRACE = "018f0000-0000-7000-8000-000000000002";

const HANDLE = new Uint8Array([1, 2, 3, 4]);

// Driven through the real stores rather than asserted against hand-written rows: what this fake owes
// a consumer is that forge's own statements read back, which only the statements themselves prove.
function stores(users: Parameters<typeof fakeAuthD1>[0]) {
  const client = createD1Client(fakeAuthD1(users) as never);
  return { users: createUserStore(client), factors: createFactorStore(client) };
}

const ACCOUNTS = [
  { id: ADA, email: "Ada@Example.com", webauthnId: HANDLE, factors: [{ kind: "passkey" }, { kind: "totp-app", confirmedAt: null }] },
  { id: GRACE, email: "grace@example.com", isAdmin: true, deactivatedAt: 99 },
];

describe("fakeAuthD1 through the user store", () => {
  it("reads an account back by id, decoding the UUID out of the BLOB column", async () => {
    const found = await stores(ACCOUNTS).users.findById(ADA);
    expect(found.ok && found.data?.id).toBe(ADA);
    expect(found.ok && found.data?.email).toBe("Ada@Example.com");
  });

  it("defaults the email key to the lowercased address, which is what the flows write", async () => {
    const found = await stores(ACCOUNTS).users.findByEmailKey("ada@example.com");
    expect(found.ok && found.data?.id).toBe(ADA);
  });

  it("carries `isAdmin` and `deactivatedAt` through, so an admin and a disabled account are both testable", async () => {
    const found = await stores(ACCOUNTS).users.findById(GRACE);
    expect(found.ok && found.data?.isAdmin).toBe(true);
    expect(found.ok && found.data?.deactivatedAt).toBe(99);
  });

  it("finds an account by its WebAuthn handle", async () => {
    const found = await stores(ACCOUNTS).users.findByWebAuthnId(HANDLE);
    expect(found.ok && found.data?.id).toBe(ADA);
  });

  it("answers no row for an id it holds no account for, rather than failing", async () => {
    const found = await stores(ACCOUNTS).users.findById("018f0000-0000-7000-8000-00000000ffff");
    expect(found.ok && found.data).toBeNull();
  });
});

describe("fakeAuthD1 through the factor store", () => {
  it("lists a user's enrolments", async () => {
    const found = await stores(ACCOUNTS).factors.listByUser(ADA);
    expect(found.ok && found.data.map((row) => row.kind)).toEqual(["passkey", "totp-app"]);
  });

  it("finds one enrolment by kind", async () => {
    const found = await stores(ACCOUNTS).factors.find(ADA, "passkey");
    expect(found.ok && found.data?.kind).toBe("passkey");
  });

  it("filters an `IN` listing to the kinds asked for", async () => {
    const found = await stores(ACCOUNTS).factors.findEnrolled(ADA, ["totp-app"]);
    expect(found.ok && found.data.map((row) => row.kind)).toEqual(["totp-app"]);
  });

  // An unconfirmed row is what an owed enrolment looks like to the registry, so it has to survive.
  it("keeps an unconfirmed enrolment unconfirmed, and confirms the rest by default", async () => {
    const found = await stores(ACCOUNTS).factors.listByUser(ADA);
    expect(found.ok && found.data.map((row) => row.confirmedAt)).toEqual([1, null]);
  });

  it("answers no enrolments for a user that has none", async () => {
    const found = await stores(ACCOUNTS).factors.listByUser(GRACE);
    expect(found.ok && found.data).toEqual([]);
  });
});
