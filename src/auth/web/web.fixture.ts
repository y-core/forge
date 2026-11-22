import type { Middleware } from "@remix-run/fetch-router";

import type { MiddlewareContribution } from "../../app/types";
import { importKeyRing } from "../../crypto/keyring/ring";
import { bytesToHex } from "../../crypto/primitives/bytes";
import { err, ok } from "../../result/result";
import { createSignedCookie } from "../../session/cookie";
import { sessionCtx } from "../../session/session";
import { uuidv7 } from "../../storage/db/uuid";
import type { ForgeIcon } from "../../ui/core/types";
import { AUTH_OTP_COOLDOWN_MS, AUTH_OTP_DIGITS, AUTH_OTP_TTL_MS, AUTH_SESSION_MAX_MS } from "../config";
import { AuthStoreError } from "../errors";
import { createFactorRegistry } from "../factors/registry";
import type {
  AuthFactorRegistry,
  AuthFactorResolution,
  AuthFactorService,
  AuthIdentifyingFactorService,
  AuthSecondFactorKind,
  AuthSecondFactorOffering,
  AuthSecondFactorService,
  EnrollableFactorService,
  RecoveryCodeFactorService,
} from "../factors/types";
import type { AuthEmailChangeFlow, AuthSecurityNotices, AuthSigninFlow, AuthSignupFlow } from "../flows/types";
import { authSessionBounds } from "../stores/sessions";
import type { AuthSessionStoreOptions } from "../stores/types";
import type {
  AdminUserStore,
  AuthChallenge,
  AuthCredential,
  AuthFactor,
  AuthFactorKind,
  AuthSecurityNotice,
  AuthSessionRecord,
  AuthSessionStore,
  AuthUser,
  ChallengeStore,
  CredentialStore,
  FactorStore,
  RecoveryCodeStore,
  UserStore,
} from "../types";
import { defineApproval } from "./approval";
import { createAuthGuards, signApprovalCode } from "./guards";
import { authCtx, establishAuthSession, markApproval, markAuthStepUp } from "./identity";
import { authPaths } from "./paths";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type {
  Approval,
  ApprovalOptions,
  AuthAdminGuardOptions,
  AuthIconName,
  AuthRequestServices,
  AuthRequestServicesResolver,
  AuthWebOptions,
  AuthWebPaths,
} from "./types";
import type { AuthFactorAssignment, AuthFactorCell, AuthFactorChoices } from "./types";

/** Escapes a literal so it can be spliced into a regular expression. */
function rx(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The opening tag of the first element whose attributes include `selector`, or `""`. @internal */
export function tagOf(html: string, selector: string): string {
  return new RegExp(`<[a-z][a-z0-9-]*[^>]*\\s${rx(selector)}(?=[\\s>=])[^>]*>`).exec(html)?.[0] ?? "";
}

/** The value `attr` carries on the first element whose attributes include `selector`, or `""`. @internal */
export function attrOf(html: string, selector: string, attr: string): string {
  return new RegExp(`\\s${rx(attr)}="([^"]*)"`).exec(tagOf(html, selector))?.[1] ?? "";
}

/** Every attribute of the first element whose attributes include `selector`, name to exact value. @internal */
export function attrsOf(html: string, selector: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tagOf(html, selector).matchAll(/\s([a-z][a-z0-9:-]*)(?:="([^"]*)")?/g)) {
    attrs[match[1] as string] = match[2] ?? "";
  }
  return attrs;
}

// Depth-counted rather than a non-greedy match: `<div>…<div>…</div></div>` is the shape every
// `Card` and `Alert` renders, and a lazy regex stops at the first `</div>` and returns half of it.
/** Every whole `tag` element whose attributes include `selector`, nesting included, in document order. @internal */
export function elementsOf(html: string, tag: string, selector: string): string[] {
  const opening = new RegExp(`<${tag}[^>]*\\s${rx(selector)}(?=[\\s>=])[^>]*>`, "g");
  const found: string[] = [];

  for (const start of [...html.matchAll(opening)]) {
    const from = start.index;
    if (found.some((element) => html.indexOf(element) <= from && from < html.indexOf(element) + element.length)) continue;

    let depth = 0;
    let cursor = from;
    const boundary = new RegExp(`<${tag}(?=[\\s>])[^>]*>|</${tag}>`, "g");
    boundary.lastIndex = from;
    for (let match = boundary.exec(html); match !== null; match = boundary.exec(html)) {
      depth += match[0].startsWith(`</`) ? -1 : 1;
      cursor = match.index + match[0].length;
      if (depth === 0) break;
    }
    if (depth === 0) found.push(html.slice(from, cursor));
  }
  return found;
}

/** The first whole `tag` element whose attributes include `selector`, children included, or `""`. @internal */
export function elementOf(html: string, tag: string, selector: string): string {
  return elementsOf(html, tag, selector)[0] ?? "";
}

/** The exact inner markup of the first such element, or `""`. @internal */
export function textOf(html: string, tag: string, selector: string): string {
  return elementOf(html, tag, selector).replace(new RegExp(`^<${tag}[^>]*>|</${tag}>$`, "g"), "");
}

/** Every value `attr` takes across `html`, in document order. @internal */
export function valuesOf(html: string, attr: string): string[] {
  return [...html.matchAll(new RegExp(`\\s${rx(attr)}="([^"]*)"`, "g"))].map((match) => match[1] ?? "");
}

/** A display string carrying every character the renderer escapes. @internal */
export const HOSTILE_TEXT = `Ada & "Bob" <script>'x'`;

/** `HOSTILE_TEXT` exactly as the renderer emits it in a text node or an attribute value. @internal */
export const HOSTILE_TEXT_ESCAPED = "Ada &amp; &quot;Bob&quot; &lt;script&gt;&#39;x&#39;";

/** The key ring every web unit signs its session cookie and its approvals with. @internal */
export const fakeWebRing = await importKeyRing(["3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370"]);

/** The session cookie every web unit mounts `sessionMiddleware` with. @internal */
export const fakeSessionCookie = createSignedCookie("__session", { path: "/", ring: fakeWebRing });

/** Which kinds carry an enrolment row; email-OTP's enrolment is a verified email, so it has none. @internal */
export const AUTH_EXPLICIT_FACTORS: readonly AuthFactorKind[] = ["passkey", "recovery-code", "totp-app"];

/** Every second-factor offering the factor matrix crosses, in listing order; empty is a deployment offering none. @internal */
export const AUTH_FACTOR_SETS: readonly (readonly AuthSecondFactorKind[])[] = [[], ["passkey"], ["totp-app"], ["passkey", "totp-app"]];

/** Every mandatory/optional assignment the factor matrix crosses `kinds` with: each subset of them made mandatory, all-optional first. @internal */
export function authFactorAssignments(kinds: readonly AuthSecondFactorKind[]): AuthFactorAssignment[] {
  const subsets = kinds.reduce<AuthSecondFactorKind[][]>((built, kind) => [...built, ...built.map((subset) => [...subset, kind])], [[]]);
  return subsets.map((mandatory) => ({ label: mandatory.length === 0 ? "optional" : `mandatory:${mandatory.join("+")}`, mandatory }));
}

/** A factor service standing in for `kind`, carrying that kind's real capabilities and enrolment style. @internal */
export function fakeFactorService(kind: "email-otp"): AuthIdentifyingFactorService;
export function fakeFactorService<kind extends AuthSecondFactorKind | "recovery-code">(kind: kind): EnrollableFactorService<kind>;
export function fakeFactorService(kind: AuthFactorKind): AuthFactorService;
export function fakeFactorService(kind: AuthFactorKind): AuthFactorService {
  const base = {
    kind,
    capabilities: { stepUp: true },
    challengeTtlMs: AUTH_OTP_TTL_MS,
    codeDigits: kind === "passkey" || kind === "recovery-code" ? null : AUTH_OTP_DIGITS,
    codePeriodSeconds: null,
    reissueAfterMs: kind === "email-otp" ? AUTH_OTP_COOLDOWN_MS : null,
    createChallenge: async () => err("unavailable" as const),
    verifyChallenge: async () => err("unavailable" as const),
    listEnrolments: async () => ok([] as readonly AuthFactor[]),
  };
  if (!AUTH_EXPLICIT_FACTORS.includes(kind)) return { ...base, enrolment: "implicit" };
  return {
    ...base,
    enrolment: "explicit",
    beginEnrolment: async () => err("unavailable" as const),
    completeEnrolment: async () => err("unavailable" as const),
  };
}

// Typed as the real factor so it can stand in an offering, but without `remaining`: a confirmed set
// then reads `remaining: null`, as it does behind a factor that cannot count its codes.
/** The recovery-code factor with no code count behind it. @internal */
export function fakeRecoveryCodeService(): RecoveryCodeFactorService {
  return fakeFactorService("recovery-code") as RecoveryCodeFactorService;
}

/** One enrolment row of `fakeFactorStore`; a bare kind is confirmed at `1`. */
interface FakeFactorEnrolment {
  readonly kind: AuthFactorKind;
  /** `null` is an enrolment begun and never confirmed. Defaults to `1`. */
  readonly confirmedAt?: number | null;
  /** Defaults to `1`. */
  readonly createdAt?: number;
}

interface FakeFactorStoreOptions {
  /** Fails every read the store answers. */
  readonly down?: boolean;
  /** Called on every read the store answers, before it answers. */
  readonly onRead?: () => void;
}

/** A factor store holding `enrolled` and nothing else. @internal */
export function fakeFactorStore(
  enrolled: readonly (AuthFactorKind | FakeFactorEnrolment)[],
  { down = false, onRead = () => {} }: FakeFactorStoreOptions = {},
): FactorStore {
  const rows = enrolled.map((entry, index) => {
    const { kind, confirmedAt = 1, createdAt = 1 } = typeof entry === "string" ? { kind: entry } : entry;
    return {
      id: `f${index}`,
      userId: "u1",
      kind,
      secret: null,
      lastCounter: null,
      failedAttempts: 0,
      lastVerifiedAt: null,
      confirmedAt,
      createdAt,
      updatedAt: createdAt,
    };
  });
  const read = <T>(answer: () => T) => {
    onRead();
    return down ? err(new AuthStoreError("unavailable", "fakeFactorStore")) : ok(answer());
  };
  return {
    listByUser: async () => read(() => rows),
    find: async (_userId, kind) => read(() => rows.find((row) => row.kind === kind) ?? null),
    listConfirmedKinds: async (_userId, kinds) =>
      read(() => rows.filter((row) => row.confirmedAt !== null && kinds.includes(row.kind)).map((row) => row.kind)),
    enrol: async () => err(new Error("fakeFactorStore: enrol is not part of the view fixture") as never),
    confirm: async () => ok(true),
    countAttempt: async (userId, kind) => ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null),
    recordVerification: async () => ok(true),
    replaceSecret: async () => ok(true),
    countSecretsNotUnder: async () => ok(0),
    remove: async () => ok("changed" as const),
  };
}

/** One stored recovery code of `fakeRecoveryCodeStore`, its hash held as hex. */
interface FakeRecoveryCode {
  readonly userId: string;
  readonly hash: string;
  staged: boolean;
  usedAt: number | null;
}

/** A recovery-code store held in memory, whose staging, commit and single-use consumption behave as the real one's. @internal */
export function fakeRecoveryCodeStore(): RecoveryCodeStore {
  let codes: FakeRecoveryCode[] = [];
  const hex = (hash: Uint8Array<ArrayBuffer>) => [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    stage: async (userId, hashes) => {
      codes = [
        ...codes.filter((code) => !(code.userId === userId && code.staged)),
        ...hashes.map((hash) => ({ userId, hash: hex(hash), staged: true, usedAt: null })),
      ];
      return ok(undefined);
    },
    holdsStaged: async (userId, hash) => ok(codes.some((code) => code.userId === userId && code.staged && code.hash === hex(hash))),
    commit: async (userId) => {
      if (!codes.some((code) => code.userId === userId && code.staged)) return ok(false);
      codes = codes.filter((code) => !(code.userId === userId && !code.staged));
      for (const code of codes) if (code.userId === userId) code.staged = false;
      return ok(true);
    },
    consume: async (userId, _factorId, hash, at) => {
      const code = codes.find((held) => held.userId === userId && !held.staged && held.usedAt === null && held.hash === hex(hash));
      if (code === undefined) return ok(false);
      code.usedAt = at;
      return ok(true);
    },
    remaining: async (userId) => ok(codes.filter((code) => code.userId === userId && !code.staged && code.usedAt === null).length),
  };
}

/** A challenge store that keeps nothing, for a fixture that only has to be built. @internal */
export function fakeChallengeStore(): ChallengeStore {
  return { put: async () => ok(undefined), take: async () => ok(null as AuthChallenge | null) };
}

/** A second-factor offering of `offered`, those of `mandatory` kind mandatory and the rest optional, with `recovery` beside it; an empty `offered` throws. @internal */
export function fakeSecondFactorOffering(
  offered: readonly (AuthSecondFactorKind | AuthSecondFactorService)[],
  mandatory: readonly AuthSecondFactorKind[] = [],
  recovery: RecoveryCodeFactorService = fakeRecoveryCodeService(),
): AuthSecondFactorOffering {
  const [first, ...rest] = offered.map((entry) => {
    const service = typeof entry === "string" ? fakeFactorService(entry) : entry;
    return { service, requirement: mandatory.includes(service.kind) ? ("mandatory" as const) : ("optional" as const) };
  });
  if (first === undefined) throw new Error("fakeSecondFactorOffering: offer at least one second factor");
  return { offered: [first, ...rest], recovery };
}

/** A registry offering email-OTP as primary and `kinds` as second factors, those in `mandatory` mandatory, with `recovery-code` beside them. @internal */
export function fakeFactorRegistry(
  kinds: readonly AuthSecondFactorKind[],
  mandatory: readonly AuthSecondFactorKind[] = [],
  store: FactorStore = fakeFactorStore([]),
): AuthFactorRegistry {
  const primary = fakeFactorService("email-otp");
  return createFactorRegistry(store, kinds.length === 0 ? { primary } : { primary, second: fakeSecondFactorOffering(kinds, mandatory) });
}

/** Every second-factor offering crossed with each of its mandatory/optional assignments, in a stable order, resolving against `enrolled`. @internal */
export function authFactorGrid(enrolled: readonly AuthFactorKind[] = []): AuthFactorCell[] {
  const store = fakeFactorStore(enrolled);
  return AUTH_FACTOR_SETS.flatMap((kinds) =>
    authFactorAssignments(kinds).map((assignment) => ({
      label: `${kinds.length === 0 ? "none" : kinds.join("+")} / ${assignment.label}`,
      kinds,
      assignment,
      registry: fakeFactorRegistry(kinds, assignment.mandatory, store),
    })),
  );
}

/** The choices `cell` offers a view. @internal */
export function factorChoices(cell: AuthFactorCell): AuthFactorChoices {
  const { primary, seconds, recovery } = cell.registry;
  const kinds = [...seconds, ...(recovery === null ? [] : [recovery])].map((service) => service.kind);
  return { primary: primary.kind, stepUp: kinds, enrollable: kinds };
}

/** What `cell` demands of a user holding the grid's enrolments, or `null` when the store refuses. @internal */
export async function factorDemand(cell: AuthFactorCell): Promise<AuthFactorResolution | null> {
  const resolved = await cell.registry.resolve("u1");
  return resolved.ok ? resolved.data : null;
}

/** One user row, with every field a store would have filled in. @internal */
export function fakeAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ada@example.com",
    emailKey: "ada@example.com",
    emailVerifiedAt: 1,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** One registered credential row. @internal */
export function fakeAuthCredential(overrides: Partial<AuthCredential> = {}): AuthCredential {
  return {
    id: "c1",
    userId: "u1",
    credentialId: "cred-1",
    publicKey: new Uint8Array(1) as Uint8Array<ArrayBuffer>,
    algorithm: -7,
    signCount: 0,
    transports: [],
    backupEligible: false,
    backedUp: false,
    label: "Laptop",
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** A user store reading `users` and refusing every write it is not given. @internal */
export function fakeAuthUserStore(users: readonly AuthUser[]): UserStore {
  const find = (predicate: (user: AuthUser) => boolean) => users.find(predicate) ?? null;
  return {
    findById: async (id) => ok(find((user) => user.id === id)),
    findByEmailKey: async (emailKey) => ok(find((user) => user.emailKey === emailKey)),
    findByWebAuthnId: async () => ok(null),
    create: async () => err(new Error("fakeAuthUserStore: create is not part of this fixture") as never),
    setWebAuthnIdIfAbsent: async () => ok(null),
    markEmailVerified: async () => ok(true),
    changeEmail: async () => ok(true),
    claimEmailChange: async () => ok(true),
  };
}

type FakeAuthSessionRow = AuthSessionRecord & { readonly userId: string };

/** An in-memory session store holding rows by token hash, refusing nothing, and holding them to `options`' lifetimes as the real store does. @internal */
export function fakeAuthSessionStore(
  users: readonly AuthUser[],
  rows: Map<string, FakeAuthSessionRow> = new Map(),
  options?: AuthSessionStoreOptions,
): AuthSessionStore & { readonly rows: Map<string, FakeAuthSessionRow> } {
  const { absoluteLifetimeMs, idleTimeoutMs, touchIntervalMs } = authSessionBounds(options);
  return {
    rows,
    create: async (input, replaces) => {
      if (replaces !== null) rows.delete(bytesToHex(replaces));
      rows.set(bytesToHex(input.tokenHash), {
        userId: input.userId,
        id: uuidv7(),
        signedInAt: input.signedInAt,
        expiresAt: input.signedInAt + absoluteLifetimeMs,
        lastSeenAt: input.signedInAt,
        stepUpAt: input.stepUp?.at ?? null,
        stepUpKind: input.stepUp?.kind ?? null,
        device: input.device ?? null,
      });
      return ok(undefined);
    },
    resolve: async (tokenHash, at) => {
      const row = rows.get(bytesToHex(tokenHash));
      const user = row === undefined ? undefined : users.find((held) => held.id === row.userId);
      if (row === undefined || user === undefined || row.expiresAt <= at || user.deactivatedAt !== null) return ok(null);
      if (idleTimeoutMs !== null && row.lastSeenAt <= at - idleTimeoutMs) return ok(null);
      if (at - row.lastSeenAt >= touchIntervalMs) rows.set(bytesToHex(tokenHash), { ...row, lastSeenAt: at });
      const { userId: _owner, ...session } = row;
      return ok({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin }, session });
    },
    rotate: async (replaces, tokenHash, stepUp) => {
      const previous = bytesToHex(replaces);
      const row = rows.get(previous);
      if (row === undefined) return ok(false);
      rows.delete(previous);
      rows.set(bytesToHex(tokenHash), stepUp === undefined ? row : { ...row, stepUpAt: stepUp.at, stepUpKind: stepUp.kind });
      return ok(true);
    },
    remove: async (tokenHash) => ok(rows.delete(bytesToHex(tokenHash))),
    listByUser: async (userId, at) =>
      ok(
        [...rows.values()]
          .filter((row) => row.userId === userId && row.expiresAt > at && (idleTimeoutMs === null || row.lastSeenAt > at - idleTimeoutMs))
          .sort((left, right) => right.signedInAt - left.signedInAt)
          .map(({ userId: _owner, ...session }) => session),
      ),
    revoke: async (userId, sessionId, _at, origin) => {
      const spared = origin.keep === null ? null : bytesToHex(origin.keep);
      const doomed = [...rows].find(([key, row]) => row.userId === userId && row.id === sessionId && key !== spared);
      return ok(doomed !== undefined && rows.delete(doomed[0]));
    },
    revokeOthers: async (userId, _at, origin) => {
      const spared = origin.keep === null ? null : bytesToHex(origin.keep);
      const doomed = [...rows].filter(([key, row]) => row.userId === userId && key !== spared).map(([key]) => key);
      for (const key of doomed) rows.delete(key);
      return ok(doomed.length);
    },
  };
}

/** Middleware signing `userId` in on this request's session through the real `establishAuthSession`, stepped up at `stepUpAt` when given. @internal */
export function signedInSession(sessions: AuthSessionStore, userId: string, stepUpAt?: number): Middleware {
  return async (context, next) => {
    const session = sessionCtx.get(context);
    const now = Date.now();
    const established = await establishAuthSession(session, sessions, userId, now, now, { kind: "email-otp" });
    if (!established.ok) throw established.error;
    if (stepUpAt !== undefined) {
      const marked = await markAuthStepUp(session, sessions, stepUpAt, now, "email-otp");
      if (!marked.ok) throw marked.error;
    }
    return next();
  };
}

/** A credential store reading `credentials`, whose writes report success. @internal */
export function fakeAuthCredentialStore(credentials: readonly AuthCredential[]): CredentialStore {
  return {
    listByUser: async (userId) => ok(credentials.filter((credential) => credential.userId === userId)),
    findByCredentialId: async (credentialId) => ok(credentials.find((credential) => credential.credentialId === credentialId) ?? null),
    create: async () => err(new Error("fakeAuthCredentialStore: create is not part of this fixture") as never),
    recordUse: async () => ok(true),
    relabel: async (id) => ok(credentials.some((credential) => credential.id === id)),
    removeForUser: async (id) => (credentials.some((credential) => credential.id === id) ? ok("changed" as const) : ok("not-found" as const)),
  };
}

/** An administrative store over `users`, with every write reporting `changed`. @internal */
export function fakeAdminUserStore(users: readonly AuthUser[], overrides: Partial<AdminUserStore> = {}): AdminUserStore {
  return {
    list: async () => ok(users),
    search: async (query) => ok(users.filter((user) => user.email.startsWith(query))),
    // Case-insensitively, as the real store is: it keys on a UUID's bytes, so an uppercased id
    // reaches the same row — and a fixture that missed it would hide the guard that must catch it.
    findById: async (id) => ok(users.find((user) => user.id.toLowerCase() === id.toLowerCase()) ?? null),
    countAdmins: async () => ok(users.filter((user) => user.isAdmin && user.deactivatedAt === null).length),
    claimFirstAdmin: async () => ok(users.some((user) => user.isAdmin && user.deactivatedAt === null) ? "admin-exists" : "changed"),
    setAdmin: async () => ok("changed" as const),
    setDeactivated: async () => ok("changed" as const),
    remove: async () => ok("changed" as const),
    resetFactors: async () => ok("changed" as const),
    ...overrides,
  };
}

/** A sign-in flow refusing everything, so a test states only the outcome it is about. @internal */
export function fakeAuthSigninFlow(overrides: Partial<AuthSigninFlow> = {}): AuthSigninFlow {
  return {
    request: (_email, at) => ({ kind: "email-otp", expiresAt: at }),
    complete: async () => err("unrecognised" as const),
    requestStepUp: async () => err("not-enrolled" as const),
    stepUp: async () => err("unrecognised" as const),
    ...overrides,
  };
}

/** A sign-up flow that answers every address alike. @internal */
export function fakeAuthSignupFlow(overrides: Partial<AuthSignupFlow> = {}): AuthSignupFlow {
  return { request: (_email, at) => ({ kind: "email-otp", expiresAt: at }), ...overrides };
}

/** An email-change flow refusing everything until a test says otherwise. @internal */
export function fakeAuthEmailChangeFlow(overrides: Partial<AuthEmailChangeFlow> = {}): AuthEmailChangeFlow {
  return {
    request: async () => err("unavailable" as const),
    inspect: async () => err("unavailable" as const),
    confirm: async () => err("unavailable" as const),
    ...overrides,
  };
}

/** A notice hook recording every notice it is handed, addressed, in the order sent. @internal */
export function fakeSecurityNotices(): AuthSecurityNotices & { readonly sent: { readonly to: string; readonly notice: AuthSecurityNotice }[] } {
  const sent: { readonly to: string; readonly notice: AuthSecurityNotice }[] = [];
  return { sent, send: (to, notice) => void sent.push({ to, notice }) };
}

/** Every href map the loaders read, built from the route builders at their default mounts. @internal */
export function fakeAuthWebPaths(): AuthWebPaths {
  return { auth: authPaths(authRoutes("/auth")), account: authPaths(accountRoutes("/account")), admin: authPaths(adminRoutes("/admin")) };
}

/** An icon component that renders nothing, so a page's markup is the page's and not the sprite's. @internal */
export const fakeAuthIcon: ForgeIcon<AuthIconName> = () => null;

/** This request's services, defaulted to the smallest deployment a page can render against. @internal */
export function fakeAuthServices(overrides: Partial<AuthRequestServices> = {}): AuthRequestServices {
  const users = [fakeAuthUser()];
  return {
    users: fakeAuthUserStore(users),
    sessions: fakeAuthSessionStore(users),
    credentials: fakeAuthCredentialStore([]),
    factors: fakeFactorRegistry([]),
    enrolments: fakeFactorStore([]),
    signin: fakeAuthSigninFlow(),
    signup: fakeAuthSignupFlow(),
    emailChange: fakeAuthEmailChangeFlow(),
    notices: fakeSecurityNotices(),
    admin: fakeAdminUserStore(users),
    ...overrides,
  };
}

/** `fakeAuthServices(overrides)` as the per-request resolver the guards take, every call answering the same services. @internal */
export function fakeAuthServicesResolver<Bindings = Record<string, unknown>>(
  overrides: Partial<AuthRequestServices> = {},
): AuthRequestServicesResolver<Bindings> {
  const services = fakeAuthServices(overrides);
  return Object.assign(async () => services, { sessions: async () => services.sessions, absoluteLifetimeMs: AUTH_SESSION_MAX_MS });
}

/** The options every loader, action factory and `register*` is called with in a test. @internal */
export function fakeAuthWebOptions(overrides: Partial<AuthWebOptions> = {}): AuthWebOptions {
  const services = fakeAuthServices();
  return { resolveServices: () => services, paths: fakeAuthWebPaths(), icon: fakeAuthIcon, now: () => 1_000, ...overrides };
}

/** The window every fake rate limit's `LIMITER` binding is declared under, as a generated `RATELIMITS` holds it. @internal */
export const FAKE_RATE_LIMITS = { LIMITER: { limit: 10, period: 60 } } as const;

/** Declares the `LIMITER` binding every fake rate limit names as optional, so a request without one answers `503` rather than failing the chain. @internal */
export const fakeLimiterContribution: MiddlewareContribution = {
  bindings: [{ name: "LIMITER", methods: ["limit"], label: "a rate-limit binding", optional: true }],
};

/** The administrator code a test approval is configured with. @internal */
export const FAKE_APPROVAL_CODE = "administrator-code";

/** An approval at `/approve` reading `FAKE_APPROVAL_CODE` under `fakeWebRing`, admitting `https://app.example` and every request its limit counts. @internal */
export function fakeApproval(overrides: Partial<ApprovalOptions> = {}): Approval {
  return defineApproval({
    path: "/approve",
    code: () => FAKE_APPROVAL_CODE,
    origin: { allowedOrigins: ["https://app.example"] },
    rateLimit: { binding: "LIMITER", key: () => "visitor" },
    ring: () => fakeWebRing,
    ...overrides,
  });
}

/** Middleware stamping every request's session as approved under `code` at `at`, which default to `FAKE_APPROVAL_CODE` and now. @internal */
export function approvedSession(at?: number, code: string = FAKE_APPROVAL_CODE): Middleware {
  return async (context, next) => {
    markApproval(sessionCtx.get(context), { presentedAt: at ?? Date.now(), digest: await signApprovalCode(fakeWebRing, code) });
    return next();
  };
}

/** The `require-auth`, `require-admin` stack `createAuthGuards` wires from `onRefuse`, over an identity a test has already set. @internal */
export function fakeAdminGuardChain(onRefuse?: AuthAdminGuardOptions["onRefuse"]): Middleware[] {
  const {
    guards: [group],
  } = createAuthGuards({
    routes: { admin: adminRoutes("/admin") },
    auth: { services: fakeAuthServicesResolver({ sessions: fakeAuthSessionStore([]) }), signinPath: "/auth/signin" },
    enrolment: { factors: () => fakeFactorRegistry([]), enrolmentPaths: { kinds: {} }, stepUpPath: "/auth/verify", settledPath: "/" },
    origin: { allowedOrigins: ["https://app.example"] },
    groups: [{ path: ["admin", "users"], guards: ["require-auth", "require-admin"], medium: "html", clearsStepUp: true }],
    onRefuse,
  });
  return [...(group?.guards ?? [])];
}

/** Middleware revoking the administrator role from the identity already on the request, as a demotion landing after `requireAdmin` admitted it would. @internal */
export const demoteAuthIdentity: Middleware = (context, next) => {
  authCtx.set(context, { ...authCtx.get(context), isAdmin: false });
  return next();
};
