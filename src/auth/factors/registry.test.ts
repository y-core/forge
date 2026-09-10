import { describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { createD1Client } from "../../storage/db/client";
import type { D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { AuthStoreError } from "../errors";
import { createFactorStore } from "../stores/factors";
import type { AuthFactor, AuthFactorKind, FactorStore } from "../types";
import { authFactorContext, createFactorRegistry } from "./registry";
import type { AuthFactorPolicy, AuthFactorService, AuthFactorsOptions, EnrollableFactorService } from "./types";

const USER_ID = uuidv7();

function service(kind: AuthFactorKind, capabilities: { primary: boolean; stepUp: boolean }, enrolment: "explicit" | "implicit"): AuthFactorService {
  const base = {
    kind,
    capabilities,
    challengeTtlMs: 600_000,
    codeDigits: 6,
    reissueAfterMs: null,
    createChallenge: () => Promise.resolve(err("unrecognised" as const)),
    verifyChallenge: () => Promise.resolve(err("unrecognised" as const)),
    listEnrolments: () => Promise.resolve(ok([] as readonly AuthFactor[])),
  };
  return enrolment === "implicit"
    ? { ...base, enrolment: "implicit" }
    : {
        ...base,
        enrolment: "explicit",
        beginEnrolment: () => Promise.resolve(err("unrecognised" as const)),
        completeEnrolment: () => Promise.resolve(err("unrecognised" as const)),
      };
}

/** The capability matrix the epic fixes: email-OTP and passkey identify, TOTP-app only proves possession. */
const EMAIL_OTP = service("email-otp", { primary: true, stepUp: true }, "implicit");
const PASSKEY = service("passkey", { primary: true, stepUp: true }, "explicit");
const TOTP_APP = service("totp-app", { primary: false, stepUp: true }, "explicit");

function factor(kind: AuthFactorKind, confirmedAt: number | null): AuthFactor {
  return { id: uuidv7(), userId: USER_ID, kind, secret: null, lastCounter: null, confirmedAt, createdAt: 1, updatedAt: 1 };
}

function stubStore(enrolled: readonly AuthFactor[], calls: AuthFactorKind[][] = []): FactorStore {
  return {
    listByUser: () => Promise.resolve(ok([])),
    find: () => Promise.resolve(ok(null)),
    findEnrolled: (_userId, kinds) => {
      calls.push([...kinds]);
      return Promise.resolve(ok(enrolled));
    },
    enrol: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.enrol"))),
    confirm: () => Promise.resolve(ok(true)),
    countAttempt: () => Promise.resolve(ok(true)),
    advanceCounter: () => Promise.resolve(ok(true)),
    remove: () => Promise.resolve(ok(true)),
  };
}

function registry(
  options: Omit<AuthFactorsOptions, "policy"> & Pick<AuthFactorsOptions, "policy">,
  store: FactorStore = stubStore([]),
): ReturnType<typeof createFactorRegistry> {
  return createFactorRegistry(store, options);
}

describe("the capability matrix", () => {
  it("fixes what each kind may be used for", () => {
    const rows: readonly { service: AuthFactorService; primary: boolean; stepUp: boolean; enrolment: string }[] = [
      { service: EMAIL_OTP, primary: true, stepUp: true, enrolment: "implicit" },
      { service: PASSKEY, primary: true, stepUp: true, enrolment: "explicit" },
      { service: TOTP_APP, primary: false, stepUp: true, enrolment: "explicit" },
    ];
    for (const row of rows) {
      expect(`${row.service.kind}: ${row.service.capabilities.primary} ${row.service.capabilities.stepUp} ${row.service.enrolment}`).toBe(
        `${row.service.kind}: ${row.primary} ${row.stepUp} ${row.enrolment}`,
      );
    }
  });

  it("reaches the enrolment ceremony through control flow, with no cast", () => {
    const reached: AuthFactorKind[] = [];
    for (const candidate of [EMAIL_OTP, PASSKEY, TOTP_APP]) {
      if (candidate.enrolment === "explicit") {
        const enrollable: EnrollableFactorService = candidate;
        expect(typeof enrollable.beginEnrolment).toBe("function");
        reached.push(candidate.kind);
      }
    }
    expect(reached).toEqual(["passkey", "totp-app"]);
  });
});

describe("createFactorRegistry — choosing the primary factor", () => {
  it("takes the only offered factor that can be primary", () => {
    expect(registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "single" } }).primary.kind).toBe("passkey");
  });

  it("takes the one a consumer names", () => {
    expect(registry({ offered: [EMAIL_OTP, PASSKEY], primary: "email-otp", policy: { mode: "single" } }).primary.kind).toBe("email-otp");
  });

  it("refuses to guess when two offered factors could be primary", () => {
    expect(() => registry({ offered: [EMAIL_OTP, PASSKEY], policy: { mode: "single" } })).toThrow(
      "createFactorRegistry: 2 offered factors can be primary — name one with `primary`",
    );
  });

  it("refuses a named primary that is not offered", () => {
    expect(() => registry({ offered: [PASSKEY], primary: "email-otp", policy: { mode: "single" } })).toThrow(
      'createFactorRegistry: "email-otp" is named as primary but is not offered',
    );
  });

  it("refuses TOTP-app as primary, because an authenticator app proves possession and does not identify", () => {
    expect(() => registry({ offered: [PASSKEY, TOTP_APP], primary: "totp-app", policy: { mode: "single" } })).toThrow(
      'createFactorRegistry: "totp-app" cannot be a primary factor',
    );
    expect(() => registry({ offered: [TOTP_APP], policy: { mode: "single" } })).toThrow(
      "createFactorRegistry: no offered factor can act as the primary one",
    );
  });

  it("refuses an empty offer", () => {
    expect(() => registry({ offered: [], policy: { mode: "single" } })).toThrow("createFactorRegistry: at least one factor must be offered");
  });
});

describe("createFactorRegistry — resolving a second factor", () => {
  it("asks for nothing under a single-factor policy, and does not touch the store", async () => {
    const calls: AuthFactorKind[][] = [];
    const resolved = await registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "single" } }, stubStore([], calls)).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "satisfied" } });
    expect(calls).toHaveLength(0);
  });

  it("demands a step-up naming exactly the confirmed enrolments", async () => {
    const store = stubStore([factor("totp-app", 5_000)]);
    const resolved = await registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "second-factor", required: "always" } }, store).resolve(
      USER_ID,
    );
    expect(resolved).toEqual({ ok: true, data: { status: "step-up-required", kinds: ["totp-app"] } });
  });

  it("ignores an unconfirmed enrolment, which is a half-finished ceremony and not a factor", async () => {
    const store = stubStore([factor("totp-app", null)]);
    const resolved = await registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "second-factor", required: "when-enrolled" } }, store).resolve(
      USER_ID,
    );
    expect(resolved).toEqual({ ok: true, data: { status: "satisfied" } });
  });

  it("asks for enrolment as a successful outcome when the policy is `always` and nothing is enrolled", async () => {
    const resolved = await registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "second-factor", required: "always" } }).resolve(USER_ID);
    expect(resolved.ok).toBe(true);
    expect(resolved).toEqual({ ok: true, data: { status: "enrolment-required", kinds: ["totp-app"] } });
  });

  it("asks for nothing when the policy is `when-enrolled` and nothing is enrolled", async () => {
    const resolved = await registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "second-factor", required: "when-enrolled" } }).resolve(
      USER_ID,
    );
    expect(resolved).toEqual({ ok: true, data: { status: "satisfied" } });
  });

  it("treats `for-roles` as `always` for a matching role and as `when-enrolled` otherwise", async () => {
    const options: AuthFactorsOptions = {
      offered: [PASSKEY, TOTP_APP],
      policy: { mode: "second-factor", required: "for-roles", roles: ["admin"] },
    };
    expect(await registry(options).resolve(USER_ID, { roles: ["admin"] })).toEqual({
      ok: true,
      data: { status: "enrolment-required", kinds: ["totp-app"] },
    });
    expect(await registry(options).resolve(USER_ID, { roles: ["member"] })).toEqual({ ok: true, data: { status: "satisfied" } });
    expect(await registry(options).resolve(USER_ID)).toEqual({ ok: true, data: { status: "satisfied" } });
  });

  it("turns a subject's `isAdmin` into the one role a `for-roles` policy is written against, and nothing otherwise", () => {
    expect(authFactorContext({ isAdmin: true })).toEqual({ roles: ["admin"] });
    expect(authFactorContext({ isAdmin: false })).toEqual({});
  });

  it("refuses at construction when a second-factor policy has nothing that could step up", () => {
    expect(() => registry({ offered: [PASSKEY], policy: { mode: "second-factor", required: "always" } })).toThrow(
      'createFactorRegistry: a second-factor policy is configured but no offered factor other than the primary "passkey" can step up',
    );
    expect(() => registry({ offered: [PASSKEY], policy: { mode: "second-factor", required: "when-enrolled" } })).toThrow(
      "createFactorRegistry: a second-factor policy is configured",
    );
    expect(() => registry({ offered: [PASSKEY], policy: { mode: "single" } })).not.toThrow();
  });

  it("never offers the primary factor as its own step-up", async () => {
    const calls: AuthFactorKind[][] = [];
    await registry(
      { offered: [EMAIL_OTP, PASSKEY, TOTP_APP], primary: "email-otp", policy: { mode: "second-factor", required: "always" } },
      stubStore([], calls),
    ).resolve(USER_ID);
    expect(calls).toEqual([["passkey", "totp-app"]]);
  });

  it("demands an implicit step-up factor from a user holding no factor rows, under both required modes", async () => {
    for (const required of ["always", "when-enrolled"] as const) {
      const resolved = await registry({ offered: [PASSKEY, EMAIL_OTP], primary: "passkey", policy: { mode: "second-factor", required } }).resolve(
        USER_ID,
      );
      expect(`${required}: ${JSON.stringify(resolved)}`).toBe(
        `${required}: ${JSON.stringify({ ok: true, data: { status: "step-up-required", kinds: ["email-otp"] } })}`,
      );
    }
  });

  it("names an implicit factor beside a confirmed explicit one, in the order they were offered", async () => {
    const store = stubStore([factor("totp-app", 5_000)]);
    const resolved = await registry(
      { offered: [PASSKEY, EMAIL_OTP, TOTP_APP], primary: "passkey", policy: { mode: "second-factor", required: "when-enrolled" } },
      store,
    ).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "step-up-required", kinds: ["email-otp", "totp-app"] } });
  });

  it("never reports `enrolment-required` with an empty kinds list, whatever is offered and whatever is enrolled", async () => {
    const offers: readonly AuthFactorsOptions["offered"][] = [
      [PASSKEY, TOTP_APP],
      [PASSKEY, EMAIL_OTP],
      [PASSKEY, EMAIL_OTP, TOTP_APP],
    ];
    const stores = [stubStore([]), stubStore([factor("totp-app", null)]), stubStore([factor("totp-app", 5_000)])];
    const policies: readonly AuthFactorPolicy[] = [
      { mode: "second-factor", required: "always" },
      { mode: "second-factor", required: "when-enrolled" },
      { mode: "second-factor", required: "for-roles", roles: ["admin"] },
    ];
    const empty: string[] = [];
    for (const offered of offers) {
      for (const policy of policies) {
        for (const store of stores) {
          const resolved = await registry({ offered, primary: "passkey", policy }, store).resolve(USER_ID, { roles: ["admin"] });
          if (!resolved.ok) throw new Error("resolve refused");
          if (resolved.data.status === "enrolment-required" && resolved.data.kinds.length === 0) {
            empty.push(`${offered.map((offer) => offer.kind).join("+")} / ${JSON.stringify(policy)}`);
          }
        }
      }
    }
    expect(empty).toEqual([]);
  });

  it("passes a store failure straight through as the AuthStoreError it was", async () => {
    const failing: FactorStore = {
      ...stubStore([]),
      findEnrolled: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.findEnrolled"))),
    };
    const resolved = await registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "second-factor", required: "always" } }, failing).resolve(
      USER_ID,
    );
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toBeInstanceOf(AuthStoreError);
  });
});

describe("createFactorRegistry — the query count", () => {
  it("issues exactly one factor-table statement for three offered factors", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await createFactorRegistry(store, {
      offered: [EMAIL_OTP, PASSKEY, TOTP_APP],
      primary: "email-otp",
      policy: { mode: "second-factor", required: "always" },
    }).resolve(USER_ID);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain("kind IN (?, ?)");
  });

  it("asks the store only about the explicit kinds, because an implicit one has no row to find", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await createFactorRegistry(store, {
      offered: [EMAIL_OTP, PASSKEY, TOTP_APP],
      primary: "passkey",
      policy: { mode: "second-factor", required: "when-enrolled" },
    }).resolve(USER_ID);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.params.slice(1)).toEqual(["totp-app"]);
  });

  it("issues no statement at all when every step-up factor is implicit", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await createFactorRegistry(store, {
      offered: [EMAIL_OTP, PASSKEY],
      primary: "passkey",
      policy: { mode: "second-factor", required: "always" },
    }).resolve(USER_ID);
    expect(db.calls).toHaveLength(0);
  });
});

describe("createFactorRegistry — find", () => {
  it("returns an offered service by kind and undefined for one that is not offered", () => {
    const built = registry({ offered: [PASSKEY, TOTP_APP], policy: { mode: "single" } });
    expect(built.find("passkey")?.kind).toBe("passkey");
    expect(built.find("email-otp")).toBeUndefined();
  });
});
