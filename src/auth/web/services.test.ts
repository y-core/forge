import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";
import type { Session } from "@remix-run/session";
import { createSession } from "@remix-run/session";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import type { AppContext } from "../../context/types";
import { createKeyRingResolver } from "../../crypto/keyring/resolver";
import type { KeyRingResolver } from "../../crypto/keyring/types";
import { requestLog } from "../../logging/request-logger";
import type { Logger, LogRecord } from "../../logging/types";
import { ok } from "../../result/result";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { createD1Client } from "../../storage/db/client";
import { fakeAuthD1 } from "../../testing/auth-fakes";
import { createTestContext, nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { captureLogs } from "../../testing/logs";
import { mapHandler } from "../../testing/route";
import type { FakeAuthUser } from "../../testing/types";
import * as passkeyFactor from "../factors/passkey";
import * as recoveryCodeFactor from "../factors/recovery-code";
import * as factorRegistry from "../factors/registry";
import * as totpAppFactor from "../factors/totp-app";
import type { AuthFactorRegistry, AuthSecondFactorKind, TotpReplaceableFactorService } from "../factors/types";
import { importAuthKeyRing } from "../keys/ring";
import { authNonceKey } from "../keys/token";
import { createChallengeStore } from "../stores/challenges";
import * as factorStores from "../stores/factors";
import { createNonceStore } from "../stores/nonces";
import * as sessionStoreModule from "../stores/sessions";
import { createAuthSessionStore } from "../stores/sessions";
import * as userStoreModule from "../stores/users";
import type { AuthMessage, UserStore } from "../types";
import { createAuthGuards, requireAdmin, requireAuth, resolveAuth } from "./guards";
import { authCtx, establishAuthSession } from "./identity";
import { AUTH_NAV_FILTERS, AUTH_NAV_SIGNOUT_SLOT, authNav } from "./nav";
import { authEnrolmentPaths, authPaths } from "./paths";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import { authRequestServices } from "./services";
import type { AuthRequestServicesOptions, AuthSecondFactorOffers } from "./types";
import { fakeSessionCookie } from "./web.fixture";

const USER_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const STRANGER_ID = "0190a1b2-c3d4-7e5f-8a9b-ffffffffffff";
const DAY_MS = 86_400_000;
const SIGNED_IN = 1_000_000;
const AT = 9_000_000;
const TOKEN_HASH = new Uint8Array(32).fill(7);
const TWO_HOURS_MS = 7_200_000;
const CALLER = { binding: "browser-1", keep: null };
// Mixed case, so the address the user store holds differs from the lowercased email key it is looked up by.
const ADA: FakeAuthUser = { id: USER_ID, email: "Ada@Example.test", webauthnId: new Uint8Array(16).fill(1) };

const PASSKEY = { rpId: "app.test", rpName: "App", origin: "https://app.test", requirement: "optional" } as const;
const TOTP = { issuer: "App", requirement: "optional" } as const;

function adaD1(users: readonly FakeAuthUser[] = [ADA]): ReturnType<typeof fakeAuthD1> {
  return fakeAuthD1(users, { rowsWritten: (sql) => (sql.includes("auth_otp_state") ? 1 : null) });
}

function servicesOver(db: ReturnType<typeof fakeAuthD1>, extra: Partial<AuthRequestServicesOptions> = {}): AuthRequestServicesOptions {
  return {
    auth: { ring: () => importAuthKeyRing(["d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65"]) },
    db: () => createD1Client(db as never),
    notifier: () => ({ send: () => Promise.resolve(ok()) }),
    defer: () => () => {},
    confirmUrl: (_c, token) => `https://app.test/email/confirm?t=${token}`,
    ...extra,
  };
}

/** A notifier and a deferral that keep what they were handed. */
function seams(): { sent: AuthMessage[]; deferred: Promise<unknown>[]; options: Pick<AuthRequestServicesOptions, "notifier" | "defer"> } {
  const sent: AuthMessage[] = [];
  const deferred: Promise<unknown>[] = [];
  return {
    sent,
    deferred,
    options: {
      notifier: () => ({
        send: (message) => {
          sent.push(message);
          return Promise.resolve(ok());
        },
      }),
      defer: () => (work) => {
        deferred.push(work);
      },
    },
  };
}

function request(url = "https://app.test/account", logger?: Logger): AppContext {
  const c = createTestContext(new Request(url), logger === undefined ? {} : { logger });
  sessionCtx.set(c, { id: "sess-1" } as Session);
  return c;
}

function enrolIn(factors: AuthFactorRegistry, kind: AuthSecondFactorKind, userId: string) {
  const service = factors.find(kind);
  if (service === undefined || !("beginEnrolment" in service)) throw new Error(`no enrollable ${kind} offered`);
  return service.beginEnrolment(userId, AT);
}

async function factorsUnder(secondFactors: AuthSecondFactorOffers | undefined) {
  const { factors } = await authRequestServices(servicesOver(adaD1(), { secondFactors }))(request());
  return factors;
}

afterEach(() => {
  mock.restore();
});

describe("authRequestServices", () => {
  it("hands the one FactorStore it returns as `enrolments` to the registry and every second factor", async () => {
    const stores = spyOn(factorStores, "createFactorStore");
    const registry = spyOn(factorRegistry, "createFactorRegistry");
    const passkey = spyOn(passkeyFactor, "createPasskeyFactor");
    const totp = spyOn(totpAppFactor, "createTotpAppFactor");
    const recovery = spyOn(recoveryCodeFactor, "createRecoveryCodeFactor");
    const resolve = authRequestServices(
      servicesOver(fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]), {
        secondFactors: {
          passkey: { rpId: "app.test", rpName: "App", origin: (c) => c.url.origin, requirement: "optional" },
          "totp-app": { issuer: "App", requirement: "mandatory" },
        },
      }),
    );

    const { enrolments } = await resolve(request());

    expect(stores).toHaveBeenCalledTimes(1);
    expect(registry.mock.calls[0]?.[0]).toBe(enrolments);
    expect(passkey.mock.calls[0]?.[0].factors).toBe(enrolments);
    expect(totp.mock.calls[0]?.[0].factors).toBe(enrolments);
    expect(recovery.mock.calls[0]?.[0].factors).toBe(enrolments);
  });

  it("builds a request's services once however often it is asked, and again for the next request", async () => {
    const resolve = authRequestServices(servicesOver(fakeAuthD1([])));
    const first = request();

    const [one, two] = await Promise.all([resolve(first), resolve(first)]);
    const next = await resolve(request());

    expect([one === two, one === next]).toEqual([true, false]);
  });

  it("asks for the D1 client once per request however often the services are asked for", async () => {
    const db = fakeAuthD1([]);
    const opened = mock(() => createD1Client(db as never));
    const resolve = authRequestServices(servicesOver(db, { db: opened }));
    const first = request();

    await Promise.all([resolve(first), resolve(first), resolve.sessions(first)]);
    await resolve(request());

    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("answers the guards the session store the services return", async () => {
    const resolve = authRequestServices(servicesOver(fakeAuthD1([])));
    const c = request();

    expect(await resolve.sessions(c)).toBe((await resolve(c)).sessions);
  });

  it("holds a session the services create to the configured lifetime when the guards resolve it on a later request", async () => {
    const resolve = authRequestServices(
      servicesOver(fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]), {
        sessionOptions: { absoluteLifetimeMs: DAY_MS, idleTimeoutMs: null },
      }),
    );
    await (
      await resolve(request())
    ).sessions.create({ tokenHash: TOKEN_HASH, userId: USER_ID, signedInAt: SIGNED_IN, signedInWith: "email-otp" }, null);
    const guard = await resolve.sessions(request());

    const live = async (at: number) => {
      const found = await guard.resolve(TOKEN_HASH, at);
      return found.ok && found.data !== null;
    };

    expect([await live(SIGNED_IN + DAY_MS - 1), await live(SIGNED_IN + DAY_MS)]).toEqual([true, false]);
  });

  it("refuses, through the guards' session store, a session idle for the configured bound and not a moment before", async () => {
    const resolve = authRequestServices(
      servicesOver(fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]), {
        sessionOptions: { absoluteLifetimeMs: DAY_MS, idleTimeoutMs: TWO_HOURS_MS },
      }),
    );
    await (
      await resolve(request())
    ).sessions.create({ tokenHash: TOKEN_HASH, userId: USER_ID, signedInAt: SIGNED_IN, signedInWith: "email-otp" }, null);
    const guard = await resolve.sessions(request());

    const live = async (at: number) => {
      const found = await guard.resolve(TOKEN_HASH, at);
      return found.ok && found.data !== null;
    };

    expect([await live(SIGNED_IN + TWO_HOURS_MS), await live(SIGNED_IN + TWO_HOURS_MS - 1)]).toEqual([false, true]);
  });

  it("states a 7-day absolute session lifetime when no sessionOptions are configured, and the configured one when they are", () => {
    const db = fakeAuthD1([]);

    expect([
      authRequestServices(servicesOver(db)).absoluteLifetimeMs,
      authRequestServices(servicesOver(db, { sessionOptions: { absoluteLifetimeMs: DAY_MS } })).absoluteLifetimeMs,
    ]).toEqual([7 * DAY_MS, DAY_MS]);
  });

  it("states the lifetime its session store enforces: a session signed in `absoluteLifetimeMs` ago no longer resolves", async () => {
    const resolve = authRequestServices(
      servicesOver(fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]), {
        sessionOptions: { absoluteLifetimeMs: TWO_HOURS_MS, idleTimeoutMs: null },
      }),
    );
    const sessions = await resolve.sessions(request());
    await sessions.create({ tokenHash: TOKEN_HASH, userId: USER_ID, signedInAt: SIGNED_IN, signedInWith: "email-otp" }, null);
    const live = async (at: number) => {
      const found = await sessions.resolve(TOKEN_HASH, at);
      return found.ok && found.data !== null;
    };

    expect([await live(SIGNED_IN + resolve.absoluteLifetimeMs), await live(SIGNED_IN + resolve.absoluteLifetimeMs - 1)]).toEqual([false, true]);
  });

  it("keeps two option sets' services apart on one request", async () => {
    const db = fakeAuthD1([]);
    const short = authRequestServices(servicesOver(db, { sessionOptions: { absoluteLifetimeMs: DAY_MS } }));
    const long = authRequestServices(servicesOver(db));
    const c = request();

    expect((await short(c)) === (await long(c))).toBe(false);
  });

  it("answers each of two option sets on one request with its own memo, not the one built first", async () => {
    const db = fakeAuthD1([]);
    const first = authRequestServices(servicesOver(db));
    const second = authRequestServices(servicesOver(db));
    const c = request();

    const [a, b] = [await first(c), await second(c)];

    expect([(await first(c)) === a, (await second(c)) === b, (await second.sessions(c)) === b.sessions]).toEqual([true, true, true]);
  });
});

describe("authRequestServices second factors", () => {
  it.each([
    { offers: undefined, offered: ["email-otp"] },
    { offers: {}, offered: ["email-otp"] },
  ])("offers the emailed code alone and no recovery codes when the second factors are $offers", async ({ offers, offered }) => {
    const factors = await factorsUnder(offers);

    expect([factors.offered.map((service) => service.kind), factors.seconds, factors.recovery, factors.mandatory]).toEqual([offered, [], null, []]);
  });

  it.each([
    { name: "a passkey", offers: { passkey: PASSKEY }, offered: ["email-otp", "passkey", "recovery-code"] },
    { name: "an authenticator app", offers: { "totp-app": TOTP }, offered: ["email-otp", "totp-app", "recovery-code"] },
    { name: "both", offers: { passkey: PASSKEY, "totp-app": TOTP }, offered: ["email-otp", "passkey", "totp-app", "recovery-code"] },
  ])("brings recovery codes with $name", async ({ offers, offered }) => {
    const factors = await factorsUnder(offers);

    expect([factors.offered.map((service) => service.kind), factors.recovery?.kind]).toEqual([offered, "recovery-code"]);
  });

  it.each([
    { offers: { passkey: PASSKEY, "totp-app": TOTP }, seconds: ["passkey", "totp-app"] },
    { offers: { "totp-app": TOTP, passkey: PASSKEY }, seconds: ["totp-app", "passkey"] },
  ])("lists the second factors in the order they are written: $seconds", async ({ offers, seconds }) => {
    const factors = await factorsUnder(offers);

    expect(factors.seconds.map((service) => service.kind)).toEqual(seconds);
  });

  it.each([
    {
      offers: { passkey: { ...PASSKEY, requirement: "mandatory" }, "totp-app": TOTP },
      mandatory: ["passkey"],
      resolution: { status: "enrolment-required", kinds: ["passkey"], stepUpKinds: [] },
    },
    {
      offers: { passkey: PASSKEY, "totp-app": { ...TOTP, requirement: "mandatory" } },
      mandatory: ["totp-app"],
      resolution: { status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] },
    },
    { offers: { passkey: PASSKEY, "totp-app": TOTP }, mandatory: [], resolution: { status: "satisfied" } },
  ] as const)("owes an unenrolled user exactly the mandatory kinds $mandatory", async ({ offers, mandatory, resolution }) => {
    const factors = await factorsUnder(offers);

    expect([factors.mandatory, await factors.resolve(USER_ID)]).toEqual([mandatory, ok(resolution)]);
  });

  it("reads the passkey relying party off each request it is built for", async () => {
    const asked: AppContext[] = [];
    const rpId = (c: AppContext) => {
      asked.push(c);
      return c.url.hostname;
    };
    const resolve = authRequestServices(servicesOver(adaD1(), { secondFactors: { passkey: { ...PASSKEY, rpId } } }));
    const here = request("https://one.app.test/account");
    const there = request("https://two.app.test/account");

    const rpOf = async (c: AppContext) => {
      const begun = await enrolIn((await resolve(c)).factors, "passkey", USER_ID);
      return begun.ok ? begun.data.options?.rp : undefined;
    };

    expect([await rpOf(here), await rpOf(there), asked]).toEqual([
      { id: "one.app.test", name: "App" },
      { id: "two.app.test", name: "App" },
      [here, there],
    ]);
  });

  it("hands the passkey factor the origin read off the request it is built for", async () => {
    const passkey = spyOn(passkeyFactor, "createPasskeyFactor");
    const asked: AppContext[] = [];
    const origin = (c: AppContext) => {
      asked.push(c);
      return c.url.origin;
    };
    const c = request("https://three.app.test/account");

    await authRequestServices(servicesOver(adaD1(), { secondFactors: { passkey: { ...PASSKEY, origin } } }))(c);

    expect([passkey.mock.calls[0]?.[0].origin, passkey.mock.calls[0]?.[0].sessionId, asked]).toEqual(["https://three.app.test", "sess-1", [c]]);
  });
});

describe("authRequestServices — a passkey name and an authenticator issuer read off the request", () => {
  type Env = { readonly RP_NAME: string; readonly ISSUER: string };
  const ENV: Env = { RP_NAME: "App from env", ISSUER: "Issuer from env" };
  const RP_NAME = "secondFactors.passkey.rpName";
  const ISSUER = 'secondFactors["totp-app"].issuer';
  const ISSUER_COLON = `authRequestServices: \`${ISSUER}\` must not hold \`:\` — an authenticator reads the label up to the first colon as the issuer.`;

  function envRequest(env: Env = ENV): AppContext<Env> {
    const c = createTestContext<Env>(new Request("https://app.test/account"), { env });
    sessionCtx.set(c, { id: "sess-1" } as Session);
    return c;
  }

  function envServices(secondFactors: AuthSecondFactorOffers<Env>, db = adaD1(), extra: Partial<AuthRequestServicesOptions<Env>> = {}) {
    return authRequestServices<Env>({ ...servicesOver(db), secondFactors, ...extra });
  }

  async function enrolled(c: AppContext<Env>, resolve: ReturnType<typeof envServices>) {
    const { factors } = await resolve(c);
    const passkey = await enrolIn(factors, "passkey", USER_ID);
    const totp = await enrolIn(factors, "totp-app", USER_ID);
    return [passkey.ok ? passkey.data.options?.rp : undefined, totp.ok ? String(totp.data.options?.uri).split("?")[0] : undefined];
  }

  it("names the relying party and the issuer from the request's env", async () => {
    const resolve = envServices({ passkey: { ...PASSKEY, rpName: (c) => c.env.RP_NAME }, "totp-app": { ...TOTP, issuer: (c) => c.env.ISSUER } });

    expect(await enrolled(envRequest(), resolve)).toEqual([
      { id: "app.test", name: "App from env" },
      "otpauth://totp/Issuer%20from%20env:Ada%40Example.test",
    ]);
  });

  it("names the relying party and the issuer from a plain string under the same bindings", async () => {
    const resolve = envServices({ passkey: PASSKEY, "totp-app": TOTP });

    expect(await enrolled(envRequest(), resolve)).toEqual([{ id: "app.test", name: "App" }, "otpauth://totp/App:Ada%40Example.test"]);
  });

  it.each([
    { field: "rpName", offers: (thrower: () => string): AuthSecondFactorOffers<Env> => ({ passkey: { ...PASSKEY, rpName: thrower } }) },
    { field: "issuer", offers: (thrower: () => string): AuthSecondFactorOffers<Env> => ({ "totp-app": { ...TOTP, issuer: thrower } }) },
  ])("rejects `await resolve(c)` with a throwing $field resolver, while the guards' session store still resolves", async ({ offers }) => {
    const misconfigured = new Error("no name for this host");
    const resolve = envServices(
      offers(() => {
        throw misconfigured;
      }),
    );
    const c = envRequest();

    const refused = await resolve(c).catch((error: unknown) => error);
    const sessions = await resolve.sessions(c);

    expect([refused === misconfigured, typeof sessions.resolve]).toEqual([true, "function"]);
  });

  const KEEP = new Uint8Array(32).fill(9);
  const REPLACER = { binding: "browser-1", keep: KEEP };
  const ADA_WITH_TOTP: FakeAuthUser = { ...ADA, factors: [{ kind: "totp-app", confirmedAt: SIGNED_IN }] };

  function counting() {
    const asked: { rpName: AppContext<Env>[]; issuer: AppContext<Env>[] } = { rpName: [], issuer: [] };
    const offers: AuthSecondFactorOffers<Env> = {
      passkey: { ...PASSKEY, rpName: (c) => (asked.rpName.push(c), c.env.RP_NAME) },
      "totp-app": { ...TOTP, issuer: (c) => (asked.issuer.push(c), c.env.ISSUER) },
    };
    return { asked, offers };
  }

  function replaceable(factors: AuthFactorRegistry): TotpReplaceableFactorService {
    const service = factors.find("totp-app");
    if (service === undefined || !("beginReplacement" in service)) throw new Error("no replaceable authenticator app offered");
    return service as TotpReplaceableFactorService;
  }

  function stepUpIn(factors: AuthFactorRegistry) {
    const service = factors.find("passkey");
    if (service === undefined) throw new Error("no passkey offered");
    return service.createChallenge(USER_ID, AT, CALLER);
  }

  async function provisioned(c: AppContext<Env>, resolve: ReturnType<typeof envServices>): Promise<string> {
    const begun = await enrolIn((await resolve(c)).factors, "totp-app", USER_ID);
    return begun.ok ? String(begun.data.options?.uri) : begun.error;
  }

  function masked(uri: string): string {
    return uri.replace(/secret=[A-Z2-7]+&/, "secret=SECRET&");
  }

  it("asks each resolver once per request however many ceremonies use it, and again for the next request", async () => {
    const { asked, offers } = counting();
    const resolve = envServices(offers, fakeAuthD1([ADA_WITH_TOTP]));
    const [first, second] = [envRequest(), envRequest()];
    const outcomes: boolean[] = [];

    for (const c of [first, second]) {
      const [{ factors }] = await Promise.all([resolve(c), resolve(c)]);
      for (const ceremony of [
        () => enrolIn(factors, "passkey", USER_ID),
        () => enrolIn(factors, "passkey", USER_ID),
        () => stepUpIn(factors),
        () => replaceable(factors).beginReplacement(USER_ID, AT, REPLACER),
        () => replaceable(factors).beginReplacement(USER_ID, AT, REPLACER),
      ]) {
        outcomes.push((await ceremony()).ok);
      }
      await resolve(c);
    }
    const which = (c: AppContext<Env>) => (c === first ? "first" : c === second ? "second" : "another");

    expect([outcomes.every(Boolean), outcomes.length, asked.rpName.map(which), asked.issuer.map(which)]).toEqual([
      true,
      10,
      ["first", "second"],
      ["first", "second"],
    ]);
  });

  it("names each request's relying party and issuer from its own env, however the requests interleave", async () => {
    const north: Env = { RP_NAME: "North", ISSUER: "North Bank" };
    const south: Env = { RP_NAME: "South", ISSUER: "South Bank" };
    const resolve = envServices(counting().offers);
    const [northern, southern] = [envRequest(north), envRequest(south)];
    await Promise.all([resolve(northern), resolve(southern)]);

    expect([await enrolled(southern, resolve), await enrolled(northern, resolve), await enrolled(envRequest(north), resolve)]).toEqual([
      [{ id: "app.test", name: "South" }, "otpauth://totp/South%20Bank:Ada%40Example.test"],
      [{ id: "app.test", name: "North" }, "otpauth://totp/North%20Bank:Ada%40Example.test"],
      [{ id: "app.test", name: "North" }, "otpauth://totp/North%20Bank:Ada%40Example.test"],
    ]);
  });

  it.each([
    { holds: "a percent sign", issuer: "100% Ops", encoded: "100%25%20Ops" },
    { holds: "doubled and trailing spaces", issuer: "Forge  Demo ", encoded: "Forge%20%20Demo%20" },
    { holds: "a Latin-1 letter", issuer: "Zürich Bank", encoded: "Z%C3%BCrich%20Bank" },
    { holds: "CJK characters", issuer: "東京", encoded: "%E6%9D%B1%E4%BA%AC" },
    { holds: "URI delimiters", issuer: "A&B=C?D#E/F", encoded: "A%26B%3DC%3FD%23E%2FF" },
  ])("percent-encodes an issuer from env holding $holds as UTF-8 in the label and the issuer parameter", async ({ issuer, encoded }) => {
    const resolve = envServices({ "totp-app": { ...TOTP, issuer: (c) => c.env.ISSUER } });

    const uri = await provisioned(envRequest({ ...ENV, ISSUER: issuer }), resolve);

    expect([masked(uri), new URL(uri).searchParams.get("issuer")]).toEqual([
      `otpauth://totp/${encoded}:Ada%40Example.test?secret=SECRET&issuer=${encoded}&algorithm=SHA1&digits=6&period=30`,
      issuer,
    ]);
  });

  it("rejects `await resolve(c)` for an issuer from env holding `:`, which the Key Uri Format would split at the first colon", async () => {
    const resolve = envServices({ "totp-app": { ...TOTP, issuer: (c) => c.env.ISSUER } });
    const c = envRequest({ ...ENV, ISSUER: "Acme: EU" });

    const refused = await resolve(c).catch((error: unknown) => error);
    const sessions = await resolve.sessions(c);

    expect([refused, typeof sessions.resolve]).toEqual([new Error(ISSUER_COLON), "function"]);
  });

  it("percent-encodes an account name holding `:` and a space, which still reads back whole after the issuer prefix", async () => {
    const resolve = envServices({ "totp-app": { ...TOTP, issuer: (c) => c.env.ISSUER } }, adaD1(), {
      address: () => ok("ops desk:ada@example.test"),
    });

    const uri = await provisioned(envRequest(), resolve);
    const label = decodeURIComponent(new URL(uri).pathname.slice(1));

    expect([masked(uri), label.slice(label.indexOf(":") + 1)]).toEqual([
      "otpauth://totp/Issuer%20from%20env:ops%20desk%3Aada%40example.test?secret=SECRET&issuer=Issuer%20from%20env&algorithm=SHA1&digits=6&period=30",
      "ops desk:ada@example.test",
    ]);
  });

  it.each([
    {
      field: "rpName",
      offers: { passkey: counting().offers.passkey },
      refusal: `authRequestServices: \`${RP_NAME}\` must not be empty or whitespace only.`,
    },
    {
      field: "issuer",
      offers: { "totp-app": counting().offers["totp-app"] },
      refusal: `authRequestServices: \`${ISSUER}\` must not be empty or whitespace only.`,
    },
  ])("rejects `await resolve(c)` for an empty or whitespace-only $field from env, naming the field", async ({ offers, refusal }) => {
    for (const blank of ["", " ", "\t\n"]) {
      const refused = await envServices(offers)(envRequest({ RP_NAME: blank, ISSUER: blank })).catch((error: unknown) => error);

      expect(refused).toEqual(new Error(refusal));
    }
  });

  it.each([
    { kind: "a no-break space", blank: "\u00a0" },
    { kind: "an em space", blank: "\u2003" },
    { kind: "an ideographic space", blank: "\u3000" },
    { kind: "a byte-order mark", blank: "\ufeff" },
    { kind: "a line separator", blank: "\u2028" },
    { kind: "a carriage return, a vertical tab and a form feed", blank: "\r\v\f" },
  ])("refuses an rpName and an issuer of only $kind, written at the call and read from env, naming each field", async ({ blank }) => {
    const atCall = (offers: AuthSecondFactorOffers<Env>) => {
      try {
        envServices(offers);
        return "accepted";
      } catch (error) {
        return error;
      }
    };
    const fromEnv = (offers: AuthSecondFactorOffers<Env>) =>
      envServices(offers)(envRequest({ RP_NAME: blank, ISSUER: blank })).then(
        () => "accepted",
        (error: unknown) => error,
      );
    const { offers } = counting();

    expect([
      atCall({ passkey: { ...PASSKEY, rpName: blank } }),
      atCall({ "totp-app": { ...TOTP, issuer: blank } }),
      await fromEnv({ passkey: offers.passkey }),
      await fromEnv({ "totp-app": offers["totp-app"] }),
    ]).toEqual([
      new Error(`authRequestServices: \`${RP_NAME}\` must not be empty or whitespace only.`),
      new Error(`authRequestServices: \`${ISSUER}\` must not be empty or whitespace only.`),
      new Error(`authRequestServices: \`${RP_NAME}\` must not be empty or whitespace only.`),
      new Error(`authRequestServices: \`${ISSUER}\` must not be empty or whitespace only.`),
    ]);
  });

  it("offers a name and an issuer written with surrounding spaces exactly as written, untrimmed", async () => {
    const resolve = envServices({ passkey: { ...PASSKEY, rpName: "  App " }, "totp-app": { ...TOTP, issuer: " Acme Ops  " } });

    expect(await enrolled(envRequest(), resolve)).toEqual([
      { id: "app.test", name: "  App " },
      "otpauth://totp/%20Acme%20Ops%20%20:Ada%40Example.test",
    ]);
  });

  it("offers a name and an issuer from env holding only a zero-width space, which is a format character and not whitespace", async () => {
    const resolve = envServices(counting().offers);

    expect(await enrolled(envRequest({ RP_NAME: "\u200b", ISSUER: "\u200b" }), resolve)).toEqual([
      { id: "app.test", name: "\u200b" },
      "otpauth://totp/%E2%80%8B:Ada%40Example.test",
    ]);
  });

  it("starts a passkey step-up naming the relying party by id alone, as a WebAuthn assertion request carries no relying-party name", async () => {
    const { asked, offers } = counting();
    const resolve = envServices({ passkey: offers.passkey });

    const begun = await stepUpIn((await resolve(envRequest())).factors);
    const options = begun.ok ? begun.data.options : undefined;

    expect([Object.keys(options ?? {}).sort(), options?.rpId, JSON.stringify(options).includes(ENV.RP_NAME), asked.rpName.length]).toEqual([
      ["allowCredentials", "challenge", "rpId", "timeout", "userVerification"],
      "app.test",
      false,
      1,
    ]);
  });

  it("files a replacement authenticator under the issuer read off the request that began it", async () => {
    const resolve = envServices(counting().offers, fakeAuthD1([ADA_WITH_TOTP]));

    const begun = await replaceable((await resolve(envRequest({ ...ENV, ISSUER: "Replaced Issuer" }))).factors).beginReplacement(
      USER_ID,
      AT,
      REPLACER,
    );

    expect(begun.ok ? masked(String(begun.data.options?.uri)) : begun.error).toBe(
      "otpauth://totp/Replaced%20Issuer:Ada%40Example.test?secret=SECRET&issuer=Replaced%20Issuer&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("asks neither resolver for the guards' session store, and each once when the full set is built after it", async () => {
    const { asked, offers } = counting();
    const resolve = envServices(offers);
    const c = envRequest();

    await resolve.sessions(c);
    const lazily = [asked.rpName.length, asked.issuer.length];
    await resolve(c);
    await resolve.sessions(c);

    expect([lazily, [asked.rpName.length, asked.issuer.length]]).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("refuses at bun check a name or issuer resolver over other bindings; cast past the type, it rejects `await resolve(c)` naming the field", async () => {
    type Other = { readonly BRAND: string };
    const brand = (c: AppContext<Other>) => c.env.BRAND;
    const mismatched: AuthSecondFactorOffers<Env> = {
      // @ts-expect-error — a name resolver over other bindings cannot read this request's env
      passkey: { ...PASSKEY, rpName: brand },
      // @ts-expect-error — an issuer resolver over other bindings cannot read this request's env
      "totp-app": { ...TOTP, issuer: brand },
    };
    const refusedFor = (offers: AuthSecondFactorOffers<Env>) => envServices(offers)(envRequest()).catch((error: unknown) => error);

    expect([await refusedFor({ passkey: mismatched.passkey }), await refusedFor({ "totp-app": mismatched["totp-app"] })]).toEqual([
      new Error(`authRequestServices: \`${RP_NAME}\` must be a string, not undefined.`),
      new Error(`authRequestServices: \`${ISSUER}\` must be a string, not undefined.`),
    ]);
  });

  it.each([
    {
      written: "an empty rpName",
      offers: { passkey: { ...PASSKEY, rpName: "" } },
      refusal: `authRequestServices: \`${RP_NAME}\` must not be empty or whitespace only.`,
    },
    {
      written: "an empty issuer",
      offers: { "totp-app": { ...TOTP, issuer: "" } },
      refusal: `authRequestServices: \`${ISSUER}\` must not be empty or whitespace only.`,
    },
    {
      written: "a whitespace-only rpName",
      offers: { passkey: { ...PASSKEY, rpName: " " } },
      refusal: `authRequestServices: \`${RP_NAME}\` must not be empty or whitespace only.`,
    },
    {
      written: "a whitespace-only issuer",
      offers: { "totp-app": { ...TOTP, issuer: "\t " } },
      refusal: `authRequestServices: \`${ISSUER}\` must not be empty or whitespace only.`,
    },
    { written: "an issuer holding `:`", offers: { "totp-app": { ...TOTP, issuer: "Acme: EU" } }, refusal: ISSUER_COLON },
    {
      written: "a null rpName",
      offers: { passkey: { ...PASSKEY, rpName: null as never } },
      refusal: `authRequestServices: \`${RP_NAME}\` must be a string, not null.`,
    },
    {
      written: "a numeric issuer",
      offers: { "totp-app": { ...TOTP, issuer: 7 as never } },
      refusal: `authRequestServices: \`${ISSUER}\` must be a string, not number.`,
    },
  ])("throws at the call for $written written as a literal, before any request", ({ offers, refusal }) => {
    expect(() => envServices(offers)).toThrow(new Error(refusal));
  });
});

describe("authRequestServices address", () => {
  it("addresses an emailed code, a passkey name and an authenticator label to the email the user store holds", async () => {
    const { sent, options } = seams();
    const { factors } = await authRequestServices(servicesOver(adaD1(), { ...options, secondFactors: { passkey: PASSKEY, "totp-app": TOTP } }))(
      request(),
    );

    const code = await factors.primary.createChallenge(USER_ID, AT, CALLER);
    const passkey = await enrolIn(factors, "passkey", USER_ID);
    const totp = await enrolIn(factors, "totp-app", USER_ID);

    expect([
      code.ok,
      sent.map((message) => message.to),
      passkey.ok ? passkey.data.options?.user : undefined,
      totp.ok ? String(totp.data.options?.uri).split("?")[0] : undefined,
    ]).toEqual([
      true,
      ["Ada@Example.test"],
      { id: "AQEBAQEBAQEBAQEBAQEBAQ", name: "Ada@Example.test", displayName: "Ada@Example.test" },
      "otpauth://totp/App:Ada%40Example.test",
    ]);
  });

  it("refuses an emailed code for an account the user store does not hold, logging the address lookup to the request logger and sending nothing", async () => {
    const capture = captureLogs();
    const { sent, options } = seams();
    const { factors } = await authRequestServices(servicesOver(adaD1(), options))(request(undefined, capture.logger));

    const refused = await factors.primary.createChallenge(STRANGER_ID, AT, CALLER);
    const records = capture.records.map(({ message, data }) => [message, (data?.error as { type: string } | undefined)?.type]);

    expect([refused, sent, records]).toEqual([{ ok: false, error: "unavailable" }, [], [["auth.email-otp.address.failed", "AuthStoreError"]]]);
  });

  it("answers a missing account's address as an unavailable store error named for the address lookup", async () => {
    const { factors } = await authRequestServices(servicesOver(adaD1([]), { secondFactors: { "totp-app": TOTP } }))(request());

    await expect(enrolIn(factors, "totp-app", STRANGER_ID)).rejects.toMatchObject({
      name: "AuthStoreError",
      code: "unavailable",
      operation: "address",
    });
  });

  it("addresses through an override, handing it the services' own user store", async () => {
    const { sent, options } = seams();
    const seen: [string, UserStore][] = [];
    const resolve = authRequestServices(
      servicesOver(adaD1(), {
        ...options,
        address: (userId, users) => {
          seen.push([userId, users]);
          return ok("ops@example.test");
        },
      }),
    );
    const services = await resolve(request());

    await services.factors.primary.createChallenge(USER_ID, AT, CALLER);

    expect([sent.map((message) => message.to), seen.length, seen[0]?.[0], seen[0]?.[1] === services.users]).toEqual([
      ["ops@example.test"],
      1,
      USER_ID,
      true,
    ]);
  });
});

describe("authRequestServices seams", () => {
  it("sends a sign-in code through the notifier inside the work it hands the deferral", async () => {
    const { sent, deferred, options } = seams();
    const { signin } = await authRequestServices(servicesOver(adaD1(), options))(request());

    signin.request("ada@example.test", AT, CALLER);
    const handed = deferred.length;
    await Promise.all(deferred);

    expect([handed, sent.map(({ to, kind }) => ({ to, kind }))]).toEqual([1, [{ to: "Ada@Example.test", kind: "otp" }]]);
  });

  it("delivers a security notice through the notifier inside the work it hands the deferral", async () => {
    const { sent, deferred, options } = seams();
    const { notices } = await authRequestServices(servicesOver(adaD1(), options))(request());
    const notice = { type: "factor-added", factorKind: "passkey", at: AT } as const;

    notices.send("Ada@Example.test", notice);
    const before = sent.length;
    await Promise.all(deferred);

    expect([before, deferred.length, sent]).toEqual([0, 1, [{ to: "Ada@Example.test", kind: "security-event", notice }]]);
  });

  it("asks each seam for this request's value with the request itself", async () => {
    const asked: string[] = [];
    const db = fakeAuthD1([]);
    const c = request();
    const note =
      <T>(name: string, value: T) =>
      (given: AppContext): T => {
        if (given === c) asked.push(name);
        return value;
      };

    await authRequestServices(
      servicesOver(db, {
        db: note("db", createD1Client(db as never)),
        notifier: note("notifier", { send: () => Promise.resolve(ok()) }),
        defer: note("defer", () => {}),
      }),
    )(c);

    expect(asked.toSorted()).toEqual(["db", "defer", "notifier"]);
  });

  it.each([
    {
      name: "a D1 client that cannot be opened",
      extra: {
        db: () => {
          throw new Error("no DB binding");
        },
      },
      message: "no DB binding",
    },
    { name: "a key ring that rejects", extra: { auth: { ring: () => Promise.reject(new Error("ring unreadable")) } }, message: "ring unreadable" },
  ])("rejects the services and the guards' session store over $name", async ({ extra, message }) => {
    const resolve = authRequestServices(servicesOver(fakeAuthD1([]), extra));
    const c = request();

    await expect(resolve(c)).rejects.toThrow(message);
    await expect(resolve.sessions(c)).rejects.toThrow(message);
  });
});

describe("authRequestServices — what the guards' path builds", () => {
  /** Services whose notifier and passkey relying party record each build of the factors and flows they feed. */
  function counted(db = adaD1()) {
    const built: string[] = [];
    const resolve = authRequestServices(
      servicesOver(db, {
        notifier: () => {
          built.push("notifier");
          return { send: () => Promise.resolve(ok()) };
        },
        secondFactors: {
          passkey: {
            ...PASSKEY,
            rpId: () => {
              built.push("passkey");
              return PASSKEY.rpId;
            },
          },
        },
      }),
    );
    return { built, resolve };
  }

  function sessionRequest(session: Session, method = "GET"): AppContext {
    const c = createTestContext(new Request("https://app.test/", { method }));
    sessionCtx.set(c, session);
    return c;
  }

  async function signedIn(resolve: ReturnType<typeof counted>["resolve"]): Promise<Session> {
    const session = createSession("sess-1");
    await establishAuthSession(session, await resolve.sessions(sessionRequest(session)), USER_ID, SIGNED_IN, SIGNED_IN, { kind: "email-otp" });
    return session;
  }

  async function throughResolveAuth(resolve: ReturnType<typeof counted>["resolve"], c: AppContext): Promise<string> {
    const answer = await resolveAuth({ services: resolve, now: () => SIGNED_IN + 1 })(c as never, async () => new Response("page"));
    return answer.text();
  }

  it("builds no factor and no flow for an anonymous GET through resolveAuth", async () => {
    const { built, resolve } = counted();

    const body = await throughResolveAuth(resolve, sessionRequest(createSession("anon")));

    expect([body, built]).toEqual(["page", []]);
  });

  it("establishes a signed-in GET's identity through resolveAuth, building no factor and no flow", async () => {
    const { built, resolve } = counted();
    const c = sessionRequest(await signedIn(resolve));

    const body = await throughResolveAuth(resolve, c);

    expect([body, authCtx.getOptional(c)?.userId, built]).toEqual(["page", USER_ID, []]);
  });

  it("builds the factors and flows a sign-in POST asks for, over the session store resolveAuth already built", async () => {
    const { built, resolve } = counted();
    const c = sessionRequest(createSession("anon"), "POST");

    await throughResolveAuth(resolve, c);
    const services = await resolve(c);
    const issued = services.signin.request("ada@example.test", AT, CALLER);

    expect([issued.kind, built, services.sessions === (await resolve.sessions(c))]).toEqual(["email-otp", ["notifier", "passkey"], true]);
  });

  it("builds the factors and flows once for two asks on one request, and again for the next request", async () => {
    const { built, resolve } = counted();
    const c = request();

    const [one, two] = await Promise.all([resolve(c), resolve(c)]);
    const before = built.length;
    await resolve(request());

    expect([one === two, before, built.length]).toEqual([true, 2, 4]);
  });
});

describe("authRequestServices — the session base the guards build and the full set shares", () => {
  function opening(db = adaD1()) {
    const clients: unknown[] = [];
    const resolve = authRequestServices(
      servicesOver(db, {
        db: () => {
          const client = createD1Client(db as never);
          clients.push(client);
          return client;
        },
      }),
    );
    return { clients, resolve };
  }

  it.each([
    {
      order: "sessions(c) first",
      run: async (r: ReturnType<typeof opening>["resolve"], c: AppContext) => [await r.sessions(c), await r(c)] as const,
    },
    {
      order: "resolve(c) first",
      run: async (r: ReturnType<typeof opening>["resolve"], c: AppContext) => {
        const services = await r(c);
        return [await r.sessions(c), services] as const;
      },
    },
  ])("answers one session store and builds every store over one D1 client, asked $order", async ({ run }) => {
    const sessionStores = spyOn(sessionStoreModule, "createAuthSessionStore");
    const userStores = spyOn(userStoreModule, "createUserStore");
    const { clients, resolve } = opening();

    const [sessions, services] = await run(resolve, request());

    expect([
      sessions === services.sessions,
      clients.length,
      sessionStores.mock.calls.length,
      sessionStores.mock.calls[0]?.[0] === clients[0],
      userStores.mock.calls[0]?.[0] === clients[0],
    ]).toEqual([true, 1, 1, true, true]);
  });

  it("builds the base and the full set once for concurrent asks of both on one request", async () => {
    const registries = spyOn(factorRegistry, "createFactorRegistry");
    const { clients, resolve } = opening();
    const c = request();

    const [one, sessions, two] = await Promise.all([resolve(c), resolve.sessions(c), resolve(c)]);

    expect([one === two, sessions === one.sessions, clients.length, registries.mock.calls.length]).toEqual([true, true, 1, 1]);
  });

  it("never shares a session store or a full set between two requests, whichever was asked first", async () => {
    const { clients, resolve } = opening();
    const [first, second] = [request(), request()];

    const secondSessions = await resolve.sessions(second);
    const firstServices = await resolve(first);
    const firstSessions = await resolve.sessions(first);
    const secondServices = await resolve(second);

    expect([
      firstSessions === secondSessions,
      firstServices === secondServices,
      firstServices.sessions === firstSessions,
      secondServices.sessions === secondSessions,
      clients.length,
    ]).toEqual([false, false, true, true, 2]);
  });

  it("rejects the guards' session store with the key ring's own error, asking no notifier, deferral or logger", async () => {
    const unreadable = new Error("ring unreadable");
    const asked: string[] = [];
    const resolve = authRequestServices(
      servicesOver(fakeAuthD1([]), {
        auth: { ring: () => Promise.reject(unreadable) },
        notifier: () => (asked.push("notifier"), { send: () => Promise.resolve(ok()) }),
        defer: () => (asked.push("defer"), () => {}),
        logger: () => (asked.push("logger"), nullLogger),
      }),
    );
    const c = request();

    const refused = await resolve.sessions(c).catch((error: unknown) => error);
    const refusedAfter = await resolve(c).catch((error: unknown) => error);

    expect([refused === unreadable, refusedAfter === unreadable, asked]).toEqual([true, true, []]);
  });

  it("rejects `await resolve(c)` with a passkey relying party's throw, while the guards' session store on that request still resolves", async () => {
    const misconfigured = new Error("no rpId for this host");
    const resolve = authRequestServices(
      servicesOver(adaD1(), {
        secondFactors: {
          passkey: {
            ...PASSKEY,
            rpId: () => {
              throw misconfigured;
            },
          },
        },
      }),
    );
    const c = request();

    const refused = await resolve(c).catch((error: unknown) => error);
    const sessions = await resolve.sessions(c);

    expect([refused === misconfigured, typeof sessions.resolve]).toEqual([true, "function"]);
  });

  it("keys the challenge and nonce stores under the restated prefixes when the guards' session store was built first", async () => {
    const db = adaD1();
    const { sent, deferred, options } = seams();
    const resolve = authRequestServices(
      servicesOver(db, { ...options, secondFactors: { passkey: PASSKEY }, prefixes: { challenge: "chal", nonce: "once" } }),
    );
    const c = request();

    await resolve.sessions(c);
    const { factors, emailChange } = await resolve(c);
    await enrolIn(factors, "passkey", USER_ID);
    await emailChange.request(USER_ID, "grace@example.test", AT);
    await Promise.all(deferred);
    const link = sent.find((message) => message.kind === "email-change");
    await emailChange.confirm(link?.kind === "email-change" ? (new URL(link.url).searchParams.get("t") ?? "") : "", AT);
    const heads = (table: string) =>
      db.calls.filter(({ sql }) => sql.includes(table) && sql.includes("INSERT INTO")).map(({ params }) => String(params[0]).split("||")[0]);

    expect([heads("auth_challenges"), heads("auth_nonces")]).toEqual([["chal"], ["once"]]);
  });

  it("logs the email-code factor's failure to the request logger when the guards' session store was built first", async () => {
    const capture = captureLogs();
    const deferred: Promise<unknown>[] = [];
    const resolve = authRequestServices(
      servicesOver(adaD1(), {
        notifier: () => ({ send: () => Promise.reject(new Error("mail relay down")) }),
        defer: () => (work) => {
          deferred.push(work);
        },
      }),
    );
    const c = request(undefined, capture.logger);

    await resolve.sessions(c);
    await (await resolve(c)).factors.primary.createChallenge(USER_ID, AT, CALLER);
    await Promise.all(deferred);

    expect(capture.records.map(({ level, message, data }) => [level, message, data?.source])).toEqual([
      ["error", "auth.email-otp.deliver.failed", "auth"],
    ]);
  });
});

describe("authRequestServices — what each guard entry point builds over the real services", () => {
  const ADMIN: FakeAuthUser = { id: STRANGER_ID, email: "root@example.test", isAdmin: true };
  const authMap = authRoutes("/auth");
  const paths = { auth: authPaths(authMap), account: authPaths(accountRoutes("/account")), admin: authPaths(adminRoutes("/admin")) };
  const now = () => SIGNED_IN + 1;

  /** Services whose every per-request seam, the passkey relying party and the factor registry record each time they are built. */
  function recorded(db: ReturnType<typeof fakeAuthD1>) {
    const seen: string[] = [];
    const registries = spyOn(factorRegistry, "createFactorRegistry");
    const note =
      <T>(name: string, value: T) =>
      (): T => {
        seen.push(name);
        return value;
      };
    const resolve = authRequestServices(
      servicesOver(db, {
        notifier: note("notifier", { send: () => Promise.resolve(ok()) }),
        defer: note("defer", () => {}),
        logger: note("logger", nullLogger),
        secondFactors: { passkey: { ...PASSKEY, rpId: note("passkey", PASSKEY.rpId) } },
      }),
    );
    const built = () => [...seen, ...registries.mock.calls.map(() => "registry")];
    return { built, resolve };
  }

  /** A `Forge` app with session middleware, signing `userId` in through a store of its own over `db`, then `guards`, then `handler` on `path`. */
  function guardedApp(
    db: ReturnType<typeof fakeAuthD1>,
    guards: readonly Middleware[],
    path: string,
    userId?: string,
    handler: Parameters<typeof mapHandler>[3] = () => new Response("page"),
  ): Forge {
    const seeder = createAuthSessionStore(createD1Client(db as never));
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    app.use("*", async (context, next) => {
      if (userId !== undefined) await establishAuthSession(sessionCtx.get(context), seeder, userId, SIGNED_IN, SIGNED_IN, { kind: "email-otp" });
      return next();
    });
    for (const guard of guards) app.use("*", guard);
    mapHandler(app, "GET", path, handler);
    return app;
  }

  /** The stacks `createAuthGuards` wires, with `enrolment.factors` read off the full set as a consumer wires it. */
  function chainOver(resolve: ReturnType<typeof recorded>["resolve"]) {
    return createAuthGuards({
      routes: { auth: authMap, account: accountRoutes("/account"), admin: adminRoutes("/admin") },
      auth: { services: resolve, signinPath: paths.auth.signin(), now },
      enrolment: {
        factors: async (c) => (await resolve(c)).factors,
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
        now,
      },
      origin: { allowedOrigins: ["https://app.test"] },
    }).guards;
  }

  function groupApp(db: ReturnType<typeof fakeAuthD1>, resolve: ReturnType<typeof recorded>["resolve"], path: string, userId?: string): Forge {
    const app = guardedApp(db, [], path, userId);
    for (const group of chainOver(resolve)) app.use([...group.paths], ...(group.guards ?? []));
    return app;
  }

  async function answerOf(res: Response) {
    return { status: res.status, location: res.headers.get("location"), body: res.status === 200 ? await res.text() : "" };
  }

  it("sends an anonymous GET through requireAuth to sign-in, building no factor, no flow and no seam", async () => {
    const db = adaD1();
    const { built, resolve } = recorded(db);
    const guard = requireAuth({
      services: resolve,
      signinPath: paths.auth.signin(),
      factors: async (c) => (await resolve(c)).factors,
      stepUpPath: "/auth/verify",
      now,
    });

    const res = await guardedApp(db, [guard], "/account").request("/account");

    expect([await answerOf(res), built()]).toEqual([{ status: 302, location: "/auth/signin?next=%2Faccount", body: "" }, []]);
  });

  it.each([
    { group: "auth.verify (resolve-auth)", path: () => paths.auth.verify.show() },
    { group: "account (require-auth)", path: () => paths.account.passkeys() },
    { group: "admin.users (require-auth, require-admin)", path: () => paths.admin.users.list() },
  ])("builds no factor, no flow and no seam for an anonymous GET of $group's stack", async ({ path }) => {
    const db = adaD1();
    const { built, resolve } = recorded(db);

    await groupApp(db, resolve, path()).request(path());

    expect(built()).toEqual([]);
  });

  it("admits a signed-in GET of auth.verify's resolve-auth stack building no factor, no flow and no seam", async () => {
    const db = adaD1();
    const { built, resolve } = recorded(db);

    const res = await groupApp(db, resolve, paths.auth.verify.show(), USER_ID).request(paths.auth.verify.show());

    expect([await answerOf(res), built()]).toEqual([{ status: 200, location: null, body: "page" }, []]);
  });

  it("builds the full set exactly once for a signed-in GET of account's stack, whose three guards each ask for the factors", async () => {
    const db = adaD1();
    const { built, resolve } = recorded(db);

    const res = await groupApp(db, resolve, paths.account.passkeys(), USER_ID).request(paths.account.passkeys());

    expect([await answerOf(res), built().toSorted()]).toEqual([
      { status: 200, location: null, body: "page" },
      ["defer", "logger", "notifier", "passkey", "registry"],
    ]);
  });

  it.each([
    { who: "an administrator", users: [ADA, ADMIN], userId: STRANGER_ID, status: 200 },
    { who: "a non-administrator", users: [ADA, ADMIN], userId: USER_ID, status: 403 },
  ])(
    "answers $who $status behind requireAuth clearing step-up and requireAdmin, building no factor, no flow and no seam",
    async ({ users, userId, status }) => {
      const db = adaD1(users);
      const { built, resolve } = recorded(db);
      const guards = [
        requireAuth({
          services: resolve,
          signinPath: paths.auth.signin(),
          factors: async (c) => (await resolve(c)).factors,
          stepUpPath: "/auth/verify",
          clearsStepUp: true,
          now,
        }),
        requireAdmin(),
      ];

      const res = await guardedApp(db, guards, "/admin/users", userId).request("/admin/users");

      expect([res.status, built()]).toEqual([status, []]);
    },
  );

  it.each([
    { who: "an anonymous visitor", userId: undefined, filters: [AUTH_NAV_FILTERS.anonymous], slots: [] },
    { who: "a signed-in member", userId: USER_ID, filters: [AUTH_NAV_FILTERS.signedIn], slots: [AUTH_NAV_SIGNOUT_SLOT] },
  ])("renders $who's navbar state through resolveAuth and authNav, building no factor, no flow and no seam", async ({ userId, filters, slots }) => {
    const db = adaD1();
    const { built, resolve } = recorded(db);
    const nav = authNav({ signoutPath: paths.auth.signout() });
    const page = async (context: Parameters<Middleware>[0]) => {
      const state = await nav(context);
      return Response.json({ filters: state.activeFilters, slots: Object.keys(state.slots) });
    };

    const res = await guardedApp(db, [resolveAuth({ services: resolve, now })], "/", userId, page).request("/");

    expect([await res.json(), built()]).toEqual([{ filters, slots }, []]);
  });

  it("answers the guards' session store over a passkey relying party that throws, so an anonymous and a signed-in GET through resolveAuth still render", async () => {
    const db = adaD1();
    const resolve = authRequestServices(
      servicesOver(db, {
        secondFactors: {
          passkey: {
            ...PASSKEY,
            rpId: () => {
              throw new Error("no rpId for this host");
            },
          },
        },
      }),
    );
    const guard = resolveAuth({ services: resolve, now });

    const anonymous = await guardedApp(db, [guard], "/").request("/");
    const signedIn = await guardedApp(db, [guard], "/", USER_ID).request("/");

    expect([await answerOf(anonymous), await answerOf(signedIn)]).toEqual([
      { status: 200, location: null, body: "page" },
      { status: 200, location: null, body: "page" },
    ]);
  });
});

describe("authRequestServices — an auth.ring wrapped in createKeyRingResolver", () => {
  interface AppEnv {
    readonly AUTH_SECRET: string;
  }
  const AUTH_SECRET = "d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65";
  const UNWRAP = "authRequestServices: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

  it("is refused at bun check whatever Bindings it was made under, and throws at the call", () => {
    const inferred = () =>
      authRequestServices({
        ...servicesOver(fakeAuthD1([])),
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        auth: { ring: createKeyRingResolver(() => importAuthKeyRing([AUTH_SECRET])) },
      });
    const typed = () =>
      authRequestServices({
        ...servicesOver(fakeAuthD1([])),
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        auth: { ring: createKeyRingResolver<AppEnv>((env) => importAuthKeyRing([env.AUTH_SECRET])) },
      });
    expect(inferred).toThrow(new Error(UNWRAP));
    expect(typed).toThrow(new Error(UNWRAP));
  });

  it("cast past the type, throws synchronously at the call naming authRequestServices and the fix, never invoking the wrapper", () => {
    let invoked = 0;
    const wrapper = createKeyRingResolver(() => importAuthKeyRing([AUTH_SECRET]));
    const counted = Object.assign((...args: Parameters<typeof wrapper>) => {
      invoked++;
      return wrapper(...args);
    }, wrapper);
    const options = servicesOver(fakeAuthD1([]), { auth: { ring: counted as unknown as KeyRingResolver } });
    let returned: unknown = "not called";
    let thrown: unknown;
    try {
      returned = authRequestServices(options);
    } catch (error) {
      thrown = error;
    }
    expect({ returned, thrown, invoked }).toEqual({ returned: "not called", thrown: new Error(UNWRAP), invoked: 0 });
  });
});

describe("authRequestServices — an auth.ring over the app's Bindings", () => {
  interface Env {
    readonly AUTH_SECRET: string;
  }
  const unringed: Omit<AuthRequestServicesOptions<Env>, "auth"> = {
    db: () => createD1Client(fakeAuthD1([]) as never),
    notifier: () => ({ send: () => Promise.resolve(ok()) }),
    defer: () => () => {},
    confirmUrl: (_c, token) => token,
  };

  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      authRequestServices<Env>({
        ...unringed,
        // @ts-expect-error — `AUTH_SECRETS` is not a binding of Env
        auth: { ring: (env) => importAuthKeyRing([env.AUTH_SECRETS]) },
      });
    const declared = () => authRequestServices<Env>({ ...unringed, auth: { ring: (env) => importAuthKeyRing([env.AUTH_SECRET]) } });
    void [missing, declared];
  });
});

describe("authRequestServices — an auth.ring still written against the request context", () => {
  it("answers the first request with the rewrite", async () => {
    const resolve = authRequestServices(
      // @ts-expect-error — under the default bindings `c.env` is `unknown`, so a stale ring fails `bun check` before it reaches the proxy
      servicesOver(fakeAuthD1([]), { auth: { ring: (c) => importAuthKeyRing([c.env.AUTH_SECRET]) } }),
    );
    const c = createTestContext(new Request("https://app.test/account"), {
      env: { AUTH_SECRET: "d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65" },
    });
    sessionCtx.set(c, { id: "sess-1" } as Session);
    await expect(resolve(c)).rejects.toThrow(
      new Error("this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`"),
    );
  });
});

describe("authRequestServices logger", () => {
  const unsent = () => ({ send: () => Promise.reject(new Error("mail relay down")) });
  const lookupFails = (sql: string) => (sql.includes("FROM auth_users WHERE email_key") ? new Error("D1 unreachable") : null);
  const notice = { type: "factor-added", factorKind: "passkey", at: AT } as const;

  const failures: {
    name: string;
    message: string;
    failOn?: (sql: string) => Error | null;
    provoke: (services: Awaited<ReturnType<ReturnType<typeof authRequestServices>>>) => unknown;
  }[] = [
    {
      name: "the email-code factor",
      message: "auth.email-otp.deliver.failed",
      provoke: (s) => s.factors.primary.createChallenge(USER_ID, AT, CALLER),
    },
    { name: "sign-in", message: "auth.signin.issue.failed", failOn: lookupFails, provoke: (s) => s.signin.request("ada@example.test", AT, CALLER) },
    { name: "sign-up", message: "auth.signup.issue.failed", failOn: lookupFails, provoke: (s) => s.signup.request("ada@example.test", AT, CALLER) },
    { name: "email change", message: "auth.email-change.deliver.failed", provoke: (s) => s.emailChange.request(USER_ID, "grace@example.test", AT) },
    { name: "the security notices", message: "auth.security-notice.failed", provoke: (s) => s.notices.send("Ada@Example.test", notice) },
  ];

  async function provokeUnder(
    { failOn, provoke }: (typeof failures)[number],
    c: AppContext,
    extra: Partial<AuthRequestServicesOptions> = {},
  ): Promise<void> {
    const deferred: Promise<unknown>[] = [];
    const db = fakeAuthD1([ADA], { rowsWritten: (sql) => (sql.includes("auth_otp_state") ? 1 : null), ...(failOn ? { failOn } : {}) });
    const services = await authRequestServices(
      servicesOver(db, {
        notifier: unsent,
        defer: () => (work) => {
          deferred.push(work);
        },
        ...extra,
      }),
    )(c);
    await provoke(services);
    await Promise.all(deferred);
  }

  const seen = (records: readonly LogRecord[]) => records.map(({ level, message, data }) => [level, message, data?.source]);

  it.each(failures)("logs $name's $message to the request logger, under the auth source, when no logger is given", async (failure) => {
    const capture = captureLogs();

    await provokeUnder(failure, request(undefined, capture.logger));

    expect(seen(capture.records)).toEqual([["error", failure.message, "auth"]]);
  });

  it.each(failures)("logs $name's $message to the `logger` option's logger, and none to the request logger, when one is given", async (failure) => {
    const onRequest = captureLogs();
    const chosen = captureLogs();
    const c = request(undefined, onRequest.logger);
    const asked: AppContext[] = [];

    await provokeUnder(failure, c, {
      logger: (given) => {
        asked.push(given);
        return chosen.logger;
      },
    });

    expect([seen(chosen.records), onRequest.records, asked]).toEqual([[["error", failure.message, undefined]], [], [c]]);
  });

  it("logs to the console under the auth prefix when the context carries no request logger and no logger is given", async () => {
    const printed = spyOn(console, "log").mockImplementation(() => {});
    const c = request();
    c.set(requestLog.key, undefined as never);

    await provokeUnder(failures[0] as (typeof failures)[number], c);
    const lines = printed.mock.calls.map(([line]) => JSON.parse(String(line)) as LogRecord);

    expect(lines.map(({ level, prefix, message }) => [level, prefix, message])).toEqual([["error", "auth", "auth.email-otp.deliver.failed"]]);
  });
});

describe("authRequestServices prefixes", () => {
  const SECRET = "d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65";
  const NONCE_TTL_SECONDS = 3600;

  /** Mints an email-change link through `prefixes`' services and spends it first through a store built by hand under the `nonce` prefix. */
  async function confirmSpentByHand(prefixes: AuthRequestServicesOptions["prefixes"]) {
    const db = adaD1();
    const { sent, deferred, options } = seams();
    const { emailChange } = await authRequestServices(servicesOver(db, { ...options, prefixes }))(request());
    await emailChange.request(USER_ID, "grace@example.test", AT);
    await Promise.all(deferred);
    const link = sent.find((message) => message.kind === "email-change");
    const token = link === undefined ? "" : (new URL(link.url).searchParams.get("t") ?? "");
    const nonce = await authNonceKey(await importAuthKeyRing([SECRET]), token);
    if (!nonce.ok) throw new Error("the link carried no token");
    await createNonceStore(createD1Client(db as never), { prefix: "nonce" }).markConsumed(nonce.data, NONCE_TTL_SECONDS);
    return emailChange.confirm(token, AT);
  }

  function challengeKeysWritten(db: ReturnType<typeof fakeAuthD1>): string[] {
    return db.calls.filter(({ sql }) => sql.includes("INSERT INTO auth_challenges")).map(({ params }) => String(params[0]));
  }

  it("refuses as consumed a token a hand-built store spent under the restated nonce prefix", async () => {
    expect(await confirmSpentByHand({ nonce: "nonce" })).toEqual({ ok: false, error: "consumed" });
  });

  it("keeps `auth:nonce` by default, where a token spent under another prefix is still unspent", async () => {
    expect((await confirmSpentByHand(undefined)).ok).toBe(true);
  });

  it("holds a ceremony's challenge under the restated challenge prefix, where a hand-built store takes it", async () => {
    const db = adaD1();
    const { factors } = await authRequestServices(servicesOver(db, { secondFactors: { passkey: PASSKEY }, prefixes: { challenge: "chal" } }))(
      request(),
    );
    await enrolIn(factors, "passkey", USER_ID);
    const [key = ""] = challengeKeysWritten(db);
    const taken = await createChallengeStore(createD1Client(db as never), { prefix: "chal" }).take(key.slice("chal||".length));

    expect([key.startsWith("chal||"), taken.ok && taken.data !== null]).toEqual([true, true]);
  });

  it("keeps `auth:challenge` by default", async () => {
    const db = adaD1();
    const { factors } = await authRequestServices(servicesOver(db, { secondFactors: { passkey: PASSKEY } }))(request());
    await enrolIn(factors, "passkey", USER_ID);

    expect(challengeKeysWritten(db).map((key) => key.split("||")[0])).toEqual(["auth:challenge"]);
  });

  it.each(["challenge", "nonce"] as const)("throws at the call for an empty %s prefix, naming the option", (store) => {
    expect(() => authRequestServices(servicesOver(fakeAuthD1([]), { prefixes: { [store]: "" } }))).toThrow(
      new Error(`authRequestServices: \`prefixes.${store}\` must not be an empty string — omit it for the default.`),
    );
  });
});

describe("authRequestServices prefixes — every store consumer", () => {
  const SECRET = "d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65";
  const NONCE_TTL_SECONDS = 3600;
  const KEEP = new Uint8Array(32).fill(9);
  const ADA_WITH_TOTP: FakeAuthUser = { ...ADA, factors: [{ kind: "totp-app", confirmedAt: SIGNED_IN }] };

  type AuthD1 = ReturnType<typeof fakeAuthD1>;

  /** `fakeAuthD1` holding the one emailed-code row it is issued, which it does not model itself. */
  function withOtpState(db: AuthD1): AuthD1 & { heldToken: () => string } {
    let held: { token: string; attempts: number; issued_at: number; expires_at: number } | null = null;
    const otp = fakeD1(() => (held === null ? [] : [held]), {
      rowsWritten: (sql, params) => {
        if (sql.includes("INSERT INTO auth_otp_state")) {
          held = { token: String(params[1]), attempts: 0, issued_at: Number(params[2]), expires_at: Number(params[3]) };
        }
        if (sql.includes("DELETE FROM auth_otp_state")) held = null;
        return 1;
      },
    });
    return {
      ...db,
      prepare: (sql: string) => (sql.includes("auth_otp_state") ? otp.prepare(sql) : db.prepare(sql)),
      heldToken: () => held?.token ?? "",
    };
  }

  async function spendByHand(db: AuthD1, prefix: string, token: string): Promise<void> {
    const nonce = await authNonceKey(await importAuthKeyRing([SECRET]), token);
    if (!nonce.ok) throw new Error("the flow minted no token");
    await createNonceStore(createD1Client(db as never), { prefix }).markConsumed(nonce.data, NONCE_TTL_SECONDS);
  }

  function emailedCode(sent: readonly AuthMessage[]): string {
    const message = sent.find((each) => each.kind === "otp");
    return message?.kind === "otp" ? message.code : "";
  }

  function linkToken(sent: readonly AuthMessage[]): string {
    const message = sent.find((each) => each.kind === "email-change");
    return message?.kind === "email-change" ? (new URL(message.url).searchParams.get("t") ?? "") : "";
  }

  function keysTouched(db: AuthD1, table: "auth_challenges" | "auth_nonces"): string[] {
    return db.calls
      .filter(({ sql }) => sql.includes(table) && (sql.includes("INSERT INTO") || sql.includes("WHERE key = ?")))
      .map(({ params }) => String(params[0]));
  }

  function headOf(key: string): string {
    return key.slice(0, key.indexOf("||"));
  }

  const NONCE_SPENDERS = [
    {
      flow: "a sign-in code",
      async run(prefixes: AuthRequestServicesOptions["prefixes"], spentUnder: string) {
        const db = withOtpState(fakeAuthD1([ADA]));
        const { sent, deferred, options } = seams();
        const { signin } = await authRequestServices(servicesOver(db, { ...options, prefixes }))(request());
        signin.request("ada@example.test", AT, CALLER);
        await Promise.all(deferred);
        await spendByHand(db, spentUnder, db.heldToken());
        const outcome = await signin.complete("ada@example.test", emailedCode(sent), AT, CALLER);
        return outcome.ok ? "accepted" : outcome.error;
      },
    },
    {
      flow: "a step-up code",
      async run(prefixes: AuthRequestServicesOptions["prefixes"], spentUnder: string) {
        const db = withOtpState(fakeAuthD1([ADA]));
        const { sent, deferred, options } = seams();
        const { signin } = await authRequestServices(servicesOver(db, { ...options, prefixes }))(request());
        await signin.requestStepUp(USER_ID, "email-otp", AT, CALLER);
        await Promise.all(deferred);
        await spendByHand(db, spentUnder, db.heldToken());
        const outcome = await signin.stepUp(USER_ID, "email-otp", emailedCode(sent), AT, CALLER);
        return outcome.ok ? "accepted" : outcome.error;
      },
    },
    {
      flow: "an email-change link",
      async run(prefixes: AuthRequestServicesOptions["prefixes"], spentUnder: string) {
        const db = adaD1();
        const { sent, deferred, options } = seams();
        const { emailChange } = await authRequestServices(servicesOver(db, { ...options, prefixes }))(request());
        await emailChange.request(USER_ID, "grace@example.test", AT);
        await Promise.all(deferred);
        const token = linkToken(sent);
        await spendByHand(db, spentUnder, token);
        const outcome = await emailChange.confirm(token, AT);
        return outcome.ok ? "accepted" : outcome.error;
      },
    },
  ];

  it.each(NONCE_SPENDERS)("refuses $flow a hand-built store spent under the restated nonce prefix", async ({ run }) => {
    expect(await run({ nonce: "nonce" }, "nonce")).toBe("consumed");
  });

  it.each(NONCE_SPENDERS)("accepts $flow spent under a prefix other than the one its services hold", async ({ run }) => {
    expect([await run({ nonce: "nonce" }, "auth:nonce"), await run(undefined, "nonce")]).toEqual(["accepted", "accepted"]);
  });

  const CHALLENGE_WRITERS = [
    { ceremony: "a passkey enrolment", user: ADA, begin: (factors: AuthFactorRegistry) => enrolIn(factors, "passkey", USER_ID) },
    {
      ceremony: "a passkey step-up",
      user: ADA,
      begin: (factors: AuthFactorRegistry) => {
        const service = factors.find("passkey");
        if (service === undefined) throw new Error("no passkey offered");
        return service.createChallenge(USER_ID, AT, CALLER);
      },
    },
    {
      ceremony: "an authenticator-app replacement",
      user: ADA_WITH_TOTP,
      begin: (factors: AuthFactorRegistry) => {
        const service = factors.find("totp-app");
        if (service === undefined || !("beginReplacement" in service)) throw new Error("no replaceable authenticator app offered");
        return (service as TotpReplaceableFactorService).beginReplacement(USER_ID, AT, { binding: "browser-1", keep: KEEP });
      },
    },
  ];

  async function beginUnder(writer: (typeof CHALLENGE_WRITERS)[number], prefixes: AuthRequestServicesOptions["prefixes"]) {
    const db = fakeAuthD1([writer.user]);
    const secondFactors = { passkey: PASSKEY, "totp-app": TOTP };
    const { factors } = await authRequestServices(servicesOver(db, { secondFactors, prefixes }))(request());
    const begun = await writer.begin(factors);
    return { db, begun: begun.ok, keys: keysTouched(db, "auth_challenges") };
  }

  it.each(CHALLENGE_WRITERS)(
    "reads and writes $ceremony's challenge only under the restated prefix, where a hand-built store takes it",
    async (writer) => {
      const { db, begun, keys } = await beginUnder(writer, { challenge: "chal" });
      const written = keysTouched(db, "auth_challenges").at(-1) ?? "";
      const taken = await createChallengeStore(createD1Client(db as never), { prefix: "chal" }).take(written.slice("chal||".length));

      expect([begun, keys.length > 0, keys.every((key) => key.startsWith("chal||")), taken.ok && taken.data !== null]).toEqual([
        true,
        true,
        true,
        true,
      ]);
    },
  );

  it.each(CHALLENGE_WRITERS)("keeps $ceremony's challenge under `auth:challenge` by default", async (writer) => {
    const { begun, keys } = await beginUnder(writer, undefined);

    expect([begun, keys.length > 0, keys.every((key) => key.startsWith("auth:challenge||"))]).toEqual([true, true, true]);
  });

  /** Writes one challenge and one nonce through services built with `prefixes`, answering the prefix each was written under. */
  async function headsUnder(prefixes: AuthRequestServicesOptions["prefixes"]): Promise<{ challenge: string[]; nonce: string[] }> {
    const db = adaD1();
    const { sent, deferred, options } = seams();
    const { factors, emailChange } = await authRequestServices(servicesOver(db, { ...options, secondFactors: { passkey: PASSKEY }, prefixes }))(
      request(),
    );
    await enrolIn(factors, "passkey", USER_ID);
    await emailChange.request(USER_ID, "grace@example.test", AT);
    await Promise.all(deferred);
    await emailChange.confirm(linkToken(sent), AT);
    return { challenge: keysTouched(db, "auth_challenges").map(headOf), nonce: keysTouched(db, "auth_nonces").map(headOf) };
  }

  it.each([
    { given: "only the nonce prefix", prefixes: { nonce: "nonce" }, heads: { challenge: ["auth:challenge"], nonce: ["nonce"] } },
    { given: "only the challenge prefix", prefixes: { challenge: "chal" }, heads: { challenge: ["chal"], nonce: ["auth:nonce"] } },
    {
      given: "the challenge prefix and an undefined nonce",
      prefixes: { challenge: "chal", nonce: undefined },
      heads: { challenge: ["chal"], nonce: ["auth:nonce"] },
    },
    {
      given: "both prefixes undefined",
      prefixes: { challenge: undefined, nonce: undefined },
      heads: { challenge: ["auth:challenge"], nonce: ["auth:nonce"] },
    },
    { given: "an empty prefixes object", prefixes: {}, heads: { challenge: ["auth:challenge"], nonce: ["auth:nonce"] } },
    { given: "no prefixes", prefixes: undefined, heads: { challenge: ["auth:challenge"], nonce: ["auth:nonce"] } },
  ])("keys each store under its default unless it is restated, given $given", async ({ prefixes, heads }) => {
    expect(await headsUnder(prefixes)).toEqual(heads);
  });

  it.each([
    { a: "app-a", b: "app-b", second: "accepted" },
    { a: "shared", b: "shared", second: "consumed" },
  ])("answers a link app $a spent as $second to app $b over the same database", async ({ a, b, second }) => {
    const db = adaD1();
    const { sent, deferred, options } = seams();
    const first = await authRequestServices(servicesOver(db, { ...options, prefixes: { nonce: a } }))(request());
    const other = await authRequestServices(servicesOver(db, { ...options, prefixes: { nonce: b } }))(request());
    await first.emailChange.request(USER_ID, "grace@example.test", AT);
    await Promise.all(deferred);
    const token = linkToken(sent);
    const outcome = (result: Awaited<ReturnType<typeof first.emailChange.confirm>>) => (result.ok ? "accepted" : result.error);

    const spent = outcome(await first.emailChange.confirm(token, AT));
    const replayed = outcome(await first.emailChange.confirm(token, AT));
    const across = outcome(await other.emailChange.confirm(token, AT));

    expect([spent, replayed, across]).toEqual(["accepted", "consumed", second]);
  });

  it.each([
    { store: "nonce", prefix: "app||a" },
    { store: "challenge", prefix: "chal||passkey:register:x" },
    { store: "challenge", prefix: "chal|" },
  ] as const)(
    "throws at the call for the $store prefix $prefix, which a session id holding the separator could collide with",
    ({ store, prefix }) => {
      expect(() => authRequestServices(servicesOver(fakeAuthD1([]), { prefixes: { [store]: prefix } }))).toThrow(
        new Error(`authRequestServices: \`prefixes.${store}\` must not hold \`||\` or end in \`|\`.`),
      );
    },
  );

  it("refuses a non-string prefix past the type at the call, as bun check does before it", () => {
    const numeric = () =>
      authRequestServices(
        servicesOver(fakeAuthD1([]), {
          // @ts-expect-error — a prefix is a string
          prefixes: { nonce: 42 },
        }),
      );
    const nulled = () =>
      authRequestServices(
        servicesOver(fakeAuthD1([]), {
          // @ts-expect-error — null is not the absence `undefined` is
          prefixes: { challenge: null },
        }),
      );

    expect(numeric).toThrow(new Error("authRequestServices: `prefixes.nonce` must be a string — omit it for the default."));
    expect(nulled).toThrow(new Error("authRequestServices: `prefixes.challenge` must be a string — omit it for the default."));
  });
});
