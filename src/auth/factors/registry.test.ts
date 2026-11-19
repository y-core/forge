import { describe, expect, it } from "bun:test";

import { err, ok } from "../../result/result";
import { createD1Client } from "../../storage/db/client";
import type { D1Database } from "../../storage/db/types";
import { uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { AuthStoreError } from "../errors";
import { createFactorStore } from "../stores/factors";
import type { AuthFactor, AuthFactorKind, FactorStore } from "../types";
import { authFactorGrid, fakeRecoveryCodeService, fakeSecondFactorOffering } from "../web/web.fixture";
import { createFactorRegistry } from "./registry";
import type {
  AuthFactorService,
  AuthFactorsOptions,
  AuthIdentifyingFactorService,
  AuthSecondFactorKind,
  AuthSecondFactorOffering,
  AuthSecondFactorRequirement,
  AuthSecondFactorService,
  EnrollableFactorService,
} from "./types";

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

const EMAIL_OTP = service("email-otp", { stepUp: true }, "implicit") as AuthIdentifyingFactorService;
const PASSKEY = service("passkey", { stepUp: true }, "explicit") as AuthSecondFactorService;
const TOTP_APP = service("totp-app", { stepUp: true }, "explicit") as AuthSecondFactorService;

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
    listConfirmedKinds: (_userId, kinds) => {
      calls.push([...kinds]);
      return Promise.resolve(ok(enrolled.filter((row) => kinds.includes(row.kind) && row.confirmedAt !== null).map((row) => row.kind)));
    },
    enrol: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.enrol"))),
    confirm: () => Promise.resolve(ok(true)),
    countAttempt: (userId, kind) => Promise.resolve(ok(enrolled.find((row) => row.userId === userId && row.kind === kind) ?? null)),
    recordVerification: () => Promise.resolve(ok(true)),
    replaceSecret: () => Promise.resolve(ok(true)),
    countSecretsNotUnder: () => Promise.resolve(ok(0)),
    remove: () => Promise.resolve(ok("changed" as const)),
  };
}

function offering(offered: readonly AuthSecondFactorService[], mandatory: readonly AuthSecondFactorKind[] = []): AuthSecondFactorOffering {
  return fakeSecondFactorOffering(offered, mandatory);
}

function registry(second: AuthSecondFactorOffering | undefined, store: FactorStore = stubStore([])): ReturnType<typeof createFactorRegistry> {
  return createFactorRegistry(store, second === undefined ? { primary: EMAIL_OTP } : { primary: EMAIL_OTP, second });
}

function refusalOf(options: AuthFactorsOptions): string {
  try {
    createFactorRegistry(stubStore([]), options);
    return "built";
  } catch (thrown) {
    return (thrown as Error).message;
  }
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
    for (const candidate of [EMAIL_OTP, PASSKEY, TOTP_APP] as readonly AuthFactorService[]) {
      if (candidate.enrolment === "explicit") {
        const enrollable: EnrollableFactorService = candidate;
        expect(typeof enrollable.beginEnrolment).toBe("function");
        reached.push(candidate.kind);
      }
    }
    expect(reached).toEqual(["passkey", "totp-app"]);
  });
});

describe("createFactorRegistry — what the types refuse", () => {
  it("does not typecheck a passkey or an authenticator app as the primary factor", () => {
    // @ts-expect-error a passkey identifies nobody, so it can never be the primary factor
    const passkey: AuthFactorsOptions = { primary: PASSKEY };
    // @ts-expect-error an authenticator app identifies nobody, so it can never be the primary factor
    const totp: AuthFactorsOptions = { primary: TOTP_APP };
    expect([passkey.primary.kind, totp.primary.kind]).toEqual(["passkey", "totp-app"]);
  });

  it("does not typecheck the emailed code, or a recovery code, offered as a second factor", () => {
    const recovery = fakeRecoveryCodeService();
    // @ts-expect-error the emailed code is the primary factor, never a second one
    const email: AuthSecondFactorOffering = { offered: [{ service: EMAIL_OTP, requirement: "optional" }], recovery };
    // @ts-expect-error recovery codes sit beside the second factors and are never offered as one
    const codes: AuthSecondFactorOffering = { offered: [{ service: fakeRecoveryCodeService(), requirement: "optional" }], recovery };
    expect([email.offered[0].service.kind, codes.offered[0].service.kind]).toEqual(["email-otp", "recovery-code"]);
  });

  it("does not typecheck an offering with no second factor, or one without recovery codes beside it", () => {
    // @ts-expect-error an offering names at least one second factor; leave `second` out to offer none
    const empty: AuthSecondFactorOffering = { offered: [], recovery: fakeRecoveryCodeService() };
    // @ts-expect-error a lost device or key would lock its users out without recovery codes
    const unrecoverable: AuthSecondFactorOffering = { offered: [{ service: TOTP_APP, requirement: "mandatory" }] };
    expect([empty.offered.length, unrecoverable.offered.length]).toEqual([0, 1]);
  });

  it("does not typecheck a bare service offered without its requirement", () => {
    // @ts-expect-error each offered second factor carries its own requirement
    const bare: AuthSecondFactorOffering = { offered: [TOTP_APP], recovery: fakeRecoveryCodeService() };
    expect(bare.offered.length).toBe(1);
  });

  it("does not typecheck a requirement on the deployment rather than on each factor", () => {
    const deployment: AuthSecondFactorOffering = {
      offered: [{ service: TOTP_APP, requirement: "optional" }],
      recovery: fakeRecoveryCodeService(),
      // @ts-expect-error the requirement is each factor's own; no deployment-wide one exists
      requirement: "required",
    };
    expect(deployment.offered.length).toBe(1);
  });

  it("does not typecheck a requirement other than mandatory or optional", () => {
    // @ts-expect-error there is no "any one of them" requirement
    const anyOne: AuthSecondFactorRequirement = "required";
    // @ts-expect-error a factor is mandatory for everyone or optional; no requirement is scoped to roles
    const roles: AuthSecondFactorRequirement = { requiredForRoles: ["admin"] };
    expect([anyOne, roles]).toEqual(["required", { requiredForRoles: ["admin"] }]);
  });
});

describe("createFactorRegistry — what it refuses to build for a caller casting past the types", () => {
  it("refuses a primary factor that does not identify the visitor", () => {
    for (const offered of [PASSKEY, TOTP_APP]) {
      expect(refusalOf({ primary: offered as unknown as AuthIdentifyingFactorService })).toBe(
        `createFactorRegistry: "${offered.kind}" cannot be a primary factor — a primary factor must identify the visitor, which only "email-otp" does`,
      );
    }
  });

  it("refuses a second factor of a kind outside `AUTH_SECOND_FACTORS`", () => {
    for (const kind of ["email-otp", "recovery-code"] as const) {
      const stray = service(kind, { stepUp: true }, "explicit") as unknown as AuthSecondFactorService;
      expect(refusalOf({ primary: EMAIL_OTP, second: offering([stray]) })).toBe(
        `createFactorRegistry: "${kind}" cannot be a second factor — only "totp-app", "passkey" may be offered as one`,
      );
    }
  });

  it("refuses the deployment-wide requirement the offering used to carry", () => {
    for (const requirement of ["optional", "required", { requiredForRoles: ["admin"] }]) {
      const second = { ...offering([TOTP_APP]), requirement } as unknown as AuthSecondFactorOffering;
      expect(refusalOf({ primary: EMAIL_OTP, second })).toBe(
        'createFactorRegistry: a second-factor offering carries no requirement of its own — give each offer its own `requirement`, "mandatory" or "optional"',
      );
    }
  });

  it("refuses a bare service offered without its requirement, and a requirement other than mandatory or optional", () => {
    const recovery = fakeRecoveryCodeService();
    const shapes = [
      { offered: [TOTP_APP], recovery },
      { offered: [{ service: TOTP_APP, requirement: "required" }], recovery },
      { offered: [{ service: TOTP_APP, requirement: { requiredForRoles: ["admin"] } }], recovery },
    ];
    for (const second of shapes) {
      expect(refusalOf({ primary: EMAIL_OTP, second: second as unknown as AuthSecondFactorOffering })).toBe(
        'createFactorRegistry: each offered second factor is `{ service, requirement }`, with `requirement` "mandatory" or "optional"',
      );
    }
  });

  it("refuses an offering without recovery codes beside it", () => {
    const second = { offered: [{ service: TOTP_APP, requirement: "mandatory" }] } as unknown as AuthSecondFactorOffering;
    expect(refusalOf({ primary: EMAIL_OTP, second })).toBe(
      'createFactorRegistry: "totp-app" is offered as a second factor without "recovery-code" — a lost device or key would lock its users out',
    );
  });

  it("refuses an offering naming no second factor", () => {
    const second = { offered: [], recovery: fakeRecoveryCodeService() } as unknown as AuthSecondFactorOffering;
    expect(refusalOf({ primary: EMAIL_OTP, second })).toBe("createFactorRegistry: a second-factor offering must offer at least one second factor");
  });

  it("refuses a second factor that cannot step up", () => {
    const bystander = service("passkey", { stepUp: false }, "explicit") as AuthSecondFactorService;
    expect(refusalOf({ primary: EMAIL_OTP, second: offering([bystander]) })).toBe('createFactorRegistry: "passkey" cannot be a second factor');
  });

  it("refuses recovery codes that cannot step up, since they are what a user with no device steps up with", () => {
    const codes = { ...fakeRecoveryCodeService(), capabilities: { stepUp: false } };
    expect(refusalOf({ primary: EMAIL_OTP, second: fakeSecondFactorOffering([TOTP_APP], ["totp-app"], codes) })).toBe(
      'createFactorRegistry: "recovery-code" cannot be a second factor',
    );
  });

  it("refuses the same kind offered twice", () => {
    expect(refusalOf({ primary: EMAIL_OTP, second: offering([TOTP_APP, TOTP_APP]) })).toBe('createFactorRegistry: "totp-app" is offered twice');
  });

  it("admits a deployment offering no second factor at all", () => {
    const built = registry(undefined);
    expect({ seconds: built.seconds, recovery: built.recovery, mandatory: built.mandatory }).toEqual({
      seconds: [],
      recovery: null,
      mandatory: [],
    });
  });

  it("keeps the offered second factors in the order they were declared, with recovery codes beside them", () => {
    const built = registry(offering([PASSKEY, TOTP_APP], ["totp-app", "passkey"]));
    expect({
      seconds: built.seconds.map((held) => held.kind),
      recovery: built.recovery?.kind,
      mandatory: built.mandatory,
      offered: built.offered.map((held) => held.kind),
    }).toEqual({
      seconds: ["passkey", "totp-app"],
      recovery: "recovery-code",
      mandatory: ["passkey", "totp-app"],
      offered: ["email-otp", "passkey", "totp-app", "recovery-code"],
    });
  });

  it("names only the mandatory kinds, leaving the optional ones out", () => {
    expect({
      app: registry(offering([TOTP_APP, PASSKEY], ["totp-app"])).mandatory,
      none: registry(offering([TOTP_APP, PASSKEY])).mandatory,
    }).toEqual({ app: ["totp-app"], none: [] });
  });
});

describe("createFactorRegistry — resolving a second factor", () => {
  it("owes a mandatory authenticator app to a user holding nothing, leaving the optional passkey out", async () => {
    const resolved = await registry(offering([TOTP_APP, PASSKEY], ["totp-app"])).resolve(USER_ID);
    expect(resolved).toEqual(ok({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] }));
  });

  it("owes a mandatory authenticator app to a user holding only the optional passkey, who steps up with it first", async () => {
    const store = stubStore([factor("passkey", 5_000)]);
    const resolved = await registry(offering([TOTP_APP, PASSKEY], ["totp-app"]), store).resolve(USER_ID);
    expect(resolved).toEqual(ok({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["passkey"] }));
  });

  it("passes a step-up with either factor once the mandatory app is held, the optional passkey included", async () => {
    const answers = await Promise.all(
      [["totp-app"], ["totp-app", "passkey"]].map((held) =>
        registry(offering([TOTP_APP, PASSKEY], ["totp-app"]), stubStore(held.map((kind) => factor(kind as AuthFactorKind, 5_000)))).resolve(
          USER_ID,
        ),
      ),
    );
    expect(answers).toEqual([
      ok({ status: "step-up-required", kinds: ["totp-app"] }),
      ok({ status: "step-up-required", kinds: ["totp-app", "passkey"] }),
    ]);
  });

  it("owes both mandatory factors, in offer order, to a user holding neither, and the other once one is held", async () => {
    const both = offering([PASSKEY, TOTP_APP], ["passkey", "totp-app"]);
    expect({
      none: await registry(both).resolve(USER_ID),
      passkey: await registry(both, stubStore([factor("passkey", 5_000)])).resolve(USER_ID),
      app: await registry(both, stubStore([factor("totp-app", 5_000)])).resolve(USER_ID),
      both: await registry(both, stubStore([factor("passkey", 5_000), factor("totp-app", 5_000)])).resolve(USER_ID),
    }).toEqual({
      none: ok({ status: "enrolment-required", kinds: ["passkey", "totp-app"], stepUpKinds: [] }),
      passkey: ok({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["passkey"] }),
      app: ok({ status: "enrolment-required", kinds: ["passkey"], stepUpKinds: ["totp-app"] }),
      both: ok({ status: "step-up-required", kinds: ["passkey", "totp-app"] }),
    });
  });

  it("owes nothing where every offered factor is optional, and steps up whatever is held", async () => {
    const optional = offering([TOTP_APP, PASSKEY]);
    expect({
      none: await registry(optional).resolve(USER_ID),
      passkey: await registry(optional, stubStore([factor("passkey", 5_000)])).resolve(USER_ID),
    }).toEqual({ none: ok({ status: "satisfied" }), passkey: ok({ status: "step-up-required", kinds: ["passkey"] }) });
  });

  it("does not count recovery codes held alone as a second factor", async () => {
    const store = stubStore([factor("recovery-code", 5_000)]);
    expect({
      optional: await registry(offering([TOTP_APP, PASSKEY]), store).resolve(USER_ID),
      mandatory: await registry(offering([TOTP_APP, PASSKEY], ["totp-app"]), store).resolve(USER_ID),
    }).toEqual({
      optional: ok({ status: "satisfied" }),
      mandatory: ok({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["recovery-code"] }),
    });
  });

  it("asks for nothing when no second factor is offered, and does not touch the store", async () => {
    const calls: AuthFactorKind[][] = [];
    const resolved = await registry(undefined, stubStore([], calls)).resolve(USER_ID);
    expect({ resolved, calls }).toEqual({ resolved: ok({ status: "satisfied" }), calls: [] });
  });

  it("owes, in every cell of the grid, exactly the mandatory kinds not held", async () => {
    const wrong: string[] = [];
    for (const held of [[], ["totp-app"], ["passkey"], ["totp-app", "passkey"]] as const) {
      for (const cell of authFactorGrid(held)) {
        const resolved = await cell.registry.resolve(USER_ID);
        const owed = cell.assignment.mandatory.filter((kind) => !(held as readonly AuthFactorKind[]).includes(kind));
        const answered = resolved.ok && resolved.data.status === "enrolment-required" ? resolved.data.kinds : [];
        if (!resolved.ok || JSON.stringify(answered) !== JSON.stringify(owed)) wrong.push(`${held.join("+") || "nothing"} in ${cell.label}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("demands a step-up naming the held second factors, in listing order, then any confirmed recovery codes", async () => {
    const store = stubStore([factor("recovery-code", 5_000), factor("passkey", 5_000), factor("totp-app", 5_000)]);
    const resolved = await registry(offering([TOTP_APP, PASSKEY]), store).resolve(USER_ID);
    expect(resolved).toEqual(ok({ status: "step-up-required", kinds: ["totp-app", "passkey", "recovery-code"] }));
  });

  it("ignores an unconfirmed enrolment, which is a half-finished ceremony and not a factor", async () => {
    const store = stubStore([factor("totp-app", null)]);
    expect({
      optional: await registry(offering([TOTP_APP]), store).resolve(USER_ID),
      mandatory: await registry(offering([TOTP_APP], ["totp-app"]), store).resolve(USER_ID),
    }).toEqual({ optional: ok({ status: "satisfied" }), mandatory: ok({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] }) });
  });

  it("names confirmed recovery codes as the step-up owed before re-enrolling a purged factor", async () => {
    const store = stubStore([factor("recovery-code", 5_000)]);
    const resolved = await registry(offering([TOTP_APP, PASSKEY], ["totp-app"]), store).resolve(USER_ID);
    expect(resolved).toEqual(ok({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["recovery-code"] }));
  });

  it("reads the offered kinds and recovery codes in one call, and never the primary factor", async () => {
    const calls: AuthFactorKind[][] = [];
    await registry(offering([PASSKEY, TOTP_APP], ["totp-app"]), stubStore([], calls)).resolve(USER_ID);
    expect(calls).toEqual([["passkey", "totp-app", "recovery-code"]]);
  });

  it("passes a store failure straight through as the AuthStoreError it was", async () => {
    const failing: FactorStore = {
      ...stubStore([]),
      listConfirmedKinds: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.listConfirmedKinds"))),
    };
    const resolved = await registry(offering([TOTP_APP], ["totp-app"]), failing).resolve(USER_ID);
    expect(resolved.ok === false && resolved.error).toBeInstanceOf(AuthStoreError);
  });
});

describe("createFactorRegistry — the query count", () => {
  it("issues exactly one factor-table statement for two offered second factors", async () => {
    const db = fakeD1(() => []);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await registry(offering([PASSKEY, TOTP_APP], ["totp-app"]), store).resolve(USER_ID);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain("kind IN (SELECT value FROM json_each(?))");
    expect(db.calls[0]?.params.slice(1)).toEqual(['["passkey","totp-app","recovery-code"]']);
  });

  it("reads the confirmed kinds alone, so no sealed secret reaches the resolution", async () => {
    const db = fakeD1(() => [{ kind: "totp-app", secret: new Uint8Array([1, 2, 3]), confirmed_at: 1 }]);
    const store = createFactorStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    const resolved = await registry(offering([TOTP_APP]), store).resolve(USER_ID);
    expect({ selects: db.calls[0]?.sql.trimStart().startsWith("SELECT kind FROM auth_factors"), resolved }).toEqual({
      selects: true,
      resolved: ok({ status: "step-up-required", kinds: ["totp-app"] }),
    });
  });
});

describe("createFactorRegistry — find", () => {
  it("returns an offered service by kind and undefined for one that is not offered", () => {
    const built = registry(offering([TOTP_APP]));
    expect([built.find("totp-app")?.kind, built.find("recovery-code")?.kind, built.find("passkey")]).toEqual([
      "totp-app",
      "recovery-code",
      undefined,
    ]);
  });
});
