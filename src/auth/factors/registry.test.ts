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
import { fakeFactorOffer } from "../web/web.fixture";
import { authFactorContext, createFactorRegistry } from "./registry";
import type { AuthFactorOffer, AuthFactorRequirement, AuthFactorService, EnrollableFactorService } from "./types";

const USER_ID = uuidv7();

function service(kind: AuthFactorKind, capabilities: { stepUp: boolean }, enrolment: "explicit" | "implicit"): AuthFactorService {
  const base = {
    kind,
    capabilities,
    challengeTtlMs: 600_000,
    codeDigits: 6,
    codePeriodSeconds: null,
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

/** The three real factor shapes: email-OTP is implicit, the other two are enrolled deliberately. */
const EMAIL_OTP = service("email-otp", { stepUp: true }, "implicit");
const PASSKEY = service("passkey", { stepUp: true }, "explicit");
const TOTP_APP = service("totp-app", { stepUp: true }, "explicit");

// A second factor that needs no enrolment row and identifies nobody, so the implicit-second cases
// can be written without offering the one identifying kind as a second factor.
const IMPLICIT_PASSKEY = service("passkey", { stepUp: true }, "implicit");

function factor(kind: AuthFactorKind, confirmedAt: number | null): AuthFactor {
  return {
    id: uuidv7(),
    userId: USER_ID,
    kind,
    secret: null,
    lastCounter: null,
    failedAttempts: 0,
    lastVerifiedAt: null,
    confirmedAt,
    createdAt: 1,
    updatedAt: 1,
  };
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
    unconfirm: () => Promise.resolve(ok(true)),
    countAttempt: (userId, kind) => Promise.resolve(ok(enrolled.find((row) => row.userId === userId && row.kind === kind) ?? null)),
    recordVerification: () => Promise.resolve(ok(true)),
    countSecretsNotUnder: () => Promise.resolve(ok(0)),
    remove: () => Promise.resolve(ok(true)),
  };
}

function primary(offered: AuthFactorService): AuthFactorOffer {
  return fakeFactorOffer(offered, "primary");
}

function second(offered: AuthFactorService, requirement: AuthFactorRequirement = "optional"): AuthFactorOffer {
  return fakeFactorOffer(offered, "second", requirement);
}

function registry(offered: readonly AuthFactorOffer[], store: FactorStore = stubStore([])): ReturnType<typeof createFactorRegistry> {
  return createFactorRegistry(store, { offered });
}

describe("the capability matrix", () => {
  it("fixes what each kind may be used for", () => {
    const rows: readonly { service: AuthFactorService; stepUp: boolean; enrolment: string }[] = [
      { service: EMAIL_OTP, stepUp: true, enrolment: "implicit" },
      { service: PASSKEY, stepUp: true, enrolment: "explicit" },
      { service: TOTP_APP, stepUp: true, enrolment: "explicit" },
    ];
    for (const row of rows) {
      expect(`${row.service.kind}: ${row.service.capabilities.stepUp} ${row.service.enrolment}`).toBe(
        `${row.service.kind}: ${row.stepUp} ${row.enrolment}`,
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

describe("createFactorRegistry — what it refuses to build", () => {
  it("takes the factor declared primary, whichever position it holds", () => {
    expect(registry([second(TOTP_APP), primary(EMAIL_OTP)]).primary.kind).toBe("email-otp");
    expect(registry([primary(EMAIL_OTP), second(PASSKEY)]).primary.kind).toBe("email-otp");
  });

  it("refuses an empty offer", () => {
    expect(() => registry([])).toThrow("createFactorRegistry: at least one factor must be offered");
  });

  it("refuses an offer declaring no primary, and one declaring several", () => {
    expect(() => registry([second(TOTP_APP)])).toThrow("createFactorRegistry: no offered factor is declared primary");
    expect(() => registry([primary(EMAIL_OTP), primary(EMAIL_OTP)])).toThrow(
      'createFactorRegistry: 2 offered factors are declared primary — "email-otp", "email-otp"',
    );
  });

  // The rule the type states: a primary factor must identify the visitor, and only the emailed code
  // does — the visitor types the address. An offer of any other kind does not typecheck either.
  it("refuses a primary factor that does not identify the visitor", () => {
    for (const offered of [PASSKEY, TOTP_APP]) {
      expect(() => registry([{ service: offered, role: "primary" } as unknown as AuthFactorOffer, second(TOTP_APP)])).toThrow(
        `createFactorRegistry: "${offered.kind}" cannot be a primary factor — a primary factor must identify the visitor, which only "email-otp" does`,
      );
    }
  });

  it("does not typecheck an offer of the passkey as primary", () => {
    // @ts-expect-error a passkey authenticates from nothing, so it can never be the primary factor
    const illegal: AuthFactorOffer = { service: PASSKEY, role: "primary" };
    expect(illegal.role).toBe("primary");
  });

  it("refuses a second factor that cannot step up", () => {
    const bystander = service("passkey", { stepUp: false }, "explicit");
    expect(() => registry([primary(EMAIL_OTP), second(bystander)])).toThrow('createFactorRegistry: "passkey" cannot be a second factor');
  });

  it("refuses the same kind declared twice", () => {
    expect(() => registry([primary(EMAIL_OTP), second(TOTP_APP), second(TOTP_APP)])).toThrow('createFactorRegistry: "totp-app" is offered twice');
  });

  // What the retired `{mode: "second-factor"}` throw used to refuse. It is now simply a deployment
  // that offers no second factor, which is the state `{mode: "single"}` named.
  it("admits an offer with no second factor at all", () => {
    const built = registry([primary(EMAIL_OTP)]);
    expect(built.seconds).toEqual([]);
  });
});

describe("createFactorRegistry — resolving a second factor", () => {
  it("asks for nothing when no second factor is offered, and does not touch the store", async () => {
    const calls: AuthFactorKind[][] = [];
    const resolved = await registry([primary(EMAIL_OTP)], stubStore([], calls)).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "satisfied" } });
    expect(calls).toHaveLength(0);
  });

  it("demands a step-up naming exactly the confirmed enrolments", async () => {
    const store = stubStore([factor("totp-app", 5_000)]);
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory")], store).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "step-up-required", kinds: ["totp-app"] } });
  });

  it("ignores an unconfirmed enrolment, which is a half-finished ceremony and not a factor", async () => {
    const store = stubStore([factor("totp-app", null)]);
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP)], store).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "satisfied" } });
  });

  it("asks for enrolment as a successful outcome when a mandatory factor is not enrolled", async () => {
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory")]).resolve(USER_ID);
    expect(resolved.ok).toBe(true);
    expect(resolved).toEqual({ ok: true, data: { status: "enrolment-required", kinds: ["totp-app"] } });
  });

  it("asks for nothing when every second factor is optional and nothing is enrolled", async () => {
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP)]).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "satisfied" } });
  });

  // The gap the per-factor requirement closes: a passkey-only account under a deployment that
  // mandates the authenticator app used to be settled, and now owes the factor it never enrolled.
  it("owes a mandatory factor even where another second factor is already confirmed", async () => {
    const store = stubStore([factor("passkey", 5_000)]);
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory"), second(PASSKEY)], store).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "enrolment-required", kinds: ["totp-app"] } });
  });

  it("names only the owed kinds, never every enrollable one", async () => {
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory"), second(PASSKEY)]).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "enrolment-required", kinds: ["totp-app"] } });
  });

  it("lets any confirmed second factor satisfy the step-up once nothing is owed", async () => {
    const store = stubStore([factor("passkey", 5_000), factor("totp-app", 5_000)]);
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory"), second(PASSKEY)], store).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "step-up-required", kinds: ["totp-app", "passkey"] } });
  });

  // The other half of the unenrolling write: a row left behind after its secret stopped opening is
  // present but unconfirmed, and it must owe an enrolment rather than a step-up it cannot pass.
  it("owes an enrolment on a row that exists and is unconfirmed, never a step-up", async () => {
    const store = stubStore([factor("totp-app", null)]);
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory")], store).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "enrolment-required", kinds: ["totp-app"] } });
  });

  it("demands `mandatoryForRoles` of a matching role alone", async () => {
    const offered = [primary(EMAIL_OTP), second(TOTP_APP, { mandatoryForRoles: ["admin"] })];
    expect(await registry(offered).resolve(USER_ID, { roles: ["admin"] })).toEqual({
      ok: true,
      data: { status: "enrolment-required", kinds: ["totp-app"] },
    });
    expect(await registry(offered).resolve(USER_ID, { roles: ["member"] })).toEqual({ ok: true, data: { status: "satisfied" } });
    expect(await registry(offered).resolve(USER_ID)).toEqual({ ok: true, data: { status: "satisfied" } });
  });

  it("turns a subject's `isAdmin` into the one role `mandatoryForRoles` is written against, and nothing otherwise", () => {
    expect(authFactorContext({ isAdmin: true })).toEqual({ roles: ["admin"] });
    expect(authFactorContext({ isAdmin: false })).toEqual({});
  });

  it("never offers the primary factor as its own step-up", async () => {
    const calls: AuthFactorKind[][] = [];
    await registry([primary(EMAIL_OTP), second(PASSKEY, "mandatory"), second(TOTP_APP, "mandatory")], stubStore([], calls)).resolve(USER_ID);
    expect(calls).toEqual([["passkey", "totp-app"]]);
  });

  it("demands an implicit step-up factor from a user holding no factor rows, whatever it is required to be", async () => {
    for (const requirement of ["mandatory", "optional"] as const) {
      const resolved = await registry([primary(EMAIL_OTP), second(IMPLICIT_PASSKEY, requirement)]).resolve(USER_ID);
      expect(`${requirement}: ${JSON.stringify(resolved)}`).toBe(
        `${requirement}: ${JSON.stringify({ ok: true, data: { status: "step-up-required", kinds: ["passkey"] } })}`,
      );
    }
  });

  it("names an implicit factor beside a confirmed explicit one, in the order they were offered", async () => {
    const store = stubStore([factor("totp-app", 5_000)]);
    const resolved = await registry([primary(EMAIL_OTP), second(IMPLICIT_PASSKEY), second(TOTP_APP)], store).resolve(USER_ID);
    expect(resolved).toEqual({ ok: true, data: { status: "step-up-required", kinds: ["passkey", "totp-app"] } });
  });

  it("never reports `enrolment-required` with an empty kinds list, whatever is offered and whatever is enrolled", async () => {
    const seconds: readonly (readonly AuthFactorService[])[] = [[TOTP_APP], [IMPLICIT_PASSKEY], [IMPLICIT_PASSKEY, TOTP_APP]];
    const stores = [stubStore([]), stubStore([factor("totp-app", null)]), stubStore([factor("totp-app", 5_000)])];
    const requirements: readonly AuthFactorRequirement[] = ["mandatory", "optional", { mandatoryForRoles: ["admin"] }];
    const empty: string[] = [];
    for (const services of seconds) {
      for (const requirement of requirements) {
        for (const store of stores) {
          const offered = [primary(EMAIL_OTP), ...services.map((held) => second(held, requirement))];
          const resolved = await registry(offered, store).resolve(USER_ID, { roles: ["admin"] });
          if (!resolved.ok) throw new Error("resolve refused");
          if (resolved.data.status === "enrolment-required" && resolved.data.kinds.length === 0) {
            empty.push(`${services.map((held) => held.kind).join("+")} / ${JSON.stringify(requirement)}`);
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
    const resolved = await registry([primary(EMAIL_OTP), second(TOTP_APP, "mandatory")], failing).resolve(USER_ID);
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toBeInstanceOf(AuthStoreError);
  });
});

describe("createFactorRegistry — the query count", () => {
  it("issues exactly one factor-table statement for three offered factors", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await createFactorRegistry(store, { offered: [primary(EMAIL_OTP), second(PASSKEY, "mandatory"), second(TOTP_APP, "mandatory")] }).resolve(
      USER_ID,
    );
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain("kind IN (?, ?)");
  });

  it("asks the store only about the explicit kinds, because an implicit one has no row to find", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await createFactorRegistry(store, { offered: [primary(EMAIL_OTP), second(IMPLICIT_PASSKEY), second(TOTP_APP)] }).resolve(USER_ID);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.params.slice(1)).toEqual(["totp-app"]);
  });

  it("issues no statement at all when every second factor is implicit", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await createFactorRegistry(store, { offered: [primary(EMAIL_OTP), second(IMPLICIT_PASSKEY, "mandatory")] }).resolve(USER_ID);
    expect(db.calls).toHaveLength(0);
  });
});

describe("createFactorRegistry — find", () => {
  it("returns an offered service by kind and undefined for one that is not offered", () => {
    const built = registry([primary(EMAIL_OTP), second(TOTP_APP)]);
    expect(built.find("totp-app")?.kind).toBe("totp-app");
    expect(built.find("passkey")).toBeUndefined();
  });
});
