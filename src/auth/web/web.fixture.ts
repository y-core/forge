import { err, ok } from "../../result/result";
import { createSignedCookie } from "../../session/cookie";
import type { ForgeIcon } from "../../ui/core/types";
import { AUTH_ADMIN_ROLE, AUTH_OTP_COOLDOWN_MS, AUTH_OTP_DIGITS, AUTH_OTP_TTL_MS } from "../config";
import { authIdentifies, createFactorRegistry } from "../factors/registry";
import type {
  AuthFactorOffer,
  AuthFactorRequirement,
  AuthFactorRegistry,
  AuthFactorResolution,
  AuthFactorService,
  AuthIdentifyingFactorService,
} from "../factors/types";
import type { AuthEmailChangeFlow, AuthSigninFlow, AuthSignupFlow } from "../flows/types";
import type {
  AdminUserStore,
  AuthChallenge,
  AuthCredential,
  AuthFactor,
  AuthFactorKind,
  AuthUser,
  ChallengeStore,
  CredentialStore,
  FactorStore,
  UserStore,
} from "../types";
import { authPaths } from "./paths";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthIconName, AuthRequestServices, AuthWebOptions, AuthWebPaths } from "./types";
import type { AuthFactorAssignment, AuthFactorCell, AuthFactorChoices, AuthFactorOffering } from "./types";

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

// One `toEqual` over the whole record is what turns "both tokens present, and different" into a
// single assertion — two `attrOf` reads would pass on a view that emitted one token twice.
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

/** A display string carrying every character the renderer escapes, so escaping is asserted the same way in both units. @internal */
export const HOSTILE_TEXT = `Ada & "Bob" <script>'x'`;

/** `HOSTILE_TEXT` exactly as the renderer emits it in a text node or an attribute value. @internal */
export const HOSTILE_TEXT_ESCAPED = "Ada &amp; &quot;Bob&quot; &lt;script&gt;&#39;x&#39;";

/** The session cookie every web unit mounts `sessionMiddleware` with. @internal */
export const fakeSessionCookie = createSignedCookie("__session", { path: "/", secrets: ["o".repeat(32)] });

/** Which kinds carry an enrolment row; email-OTP's enrolment is a verified email, so it has none. @internal */
export const AUTH_EXPLICIT_FACTORS: readonly AuthFactorKind[] = ["passkey", "totp-app"];

/** Every offered set the factor matrix crosses — none, each, every pair, all three. @internal */
export const AUTH_FACTOR_SETS: readonly (readonly AuthFactorKind[])[] = [
  [],
  ["email-otp"],
  ["passkey"],
  ["totp-app"],
  ["email-otp", "passkey"],
  ["email-otp", "totp-app"],
  ["passkey", "totp-app"],
  ["email-otp", "passkey", "totp-app"],
];

// A requirement is per factor, so the full cross is 3ⁿ per offering. These four are the shapes that
// differ in behaviour — nothing demanded, everything demanded, a mix, and a demand only a role carries.
/** Every requirement assignment the factor matrix crosses. @internal */
export const AUTH_FACTOR_ASSIGNMENTS: readonly AuthFactorAssignment[] = [
  { label: "all-optional", requirement: () => "optional" },
  { label: "all-mandatory", requirement: () => "mandatory" },
  { label: "first-mandatory", requirement: (index) => (index === 0 ? "mandatory" : "optional") },
  { label: "for-roles", requirement: () => ({ mandatoryForRoles: [AUTH_ADMIN_ROLE] }) },
];

/** A factor service standing in for `kind`, carrying that kind's real capabilities and enrolment style. @internal */
export function fakeFactorService<kind extends AuthFactorKind>(kind: kind): AuthFactorService<kind> {
  const base = {
    kind,
    capabilities: { stepUp: true },
    challengeTtlMs: AUTH_OTP_TTL_MS,
    codeDigits: kind === "passkey" ? null : AUTH_OTP_DIGITS,
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

/** A factor store reporting `enrolled` as confirmed and nothing else. @internal */
export function fakeFactorStore(enrolled: readonly AuthFactorKind[]): FactorStore {
  const rows = enrolled.map((kind, index) => ({
    id: `f${index}`,
    userId: "u1",
    kind,
    secret: null,
    lastCounter: null,
    failedAttempts: 0,
    lastVerifiedAt: null,
    confirmedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }));
  return {
    listByUser: async () => ok(rows),
    find: async (_userId, kind) => ok(rows.find((row) => row.kind === kind) ?? null),
    findEnrolled: async (_userId, kinds) => ok(rows.filter((row) => kinds.includes(row.kind))),
    enrol: async () => err(new Error("fakeFactorStore: enrol is not part of the view fixture") as never),
    confirm: async () => ok(true),
    unconfirm: async () => ok(true),
    countAttempt: async (userId, kind) => ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null),
    recordVerification: async () => ok(true),
    countSecretsNotUnder: async () => ok(0),
    remove: async () => ok(true),
  };
}

/** A challenge store that keeps nothing, for a fixture that only has to be built. @internal */
export function fakeChallengeStore(): ChallengeStore {
  return { put: async () => ok(undefined), take: async () => ok(null as AuthChallenge | null) };
}

// A fixture that refuses to build an illegal offer is the point: the grid states the ruling as data,
// so a non-identifying kind must never reach `createFactorRegistry` wearing a primary offer.
/** One offer of a kind, or of a service, in `role`; a primary offer of a non-identifying kind throws. @internal */
export function fakeFactorOffer(
  offered: AuthFactorKind | AuthFactorService,
  role: "primary" | "second",
  requirement: AuthFactorRequirement = "optional",
): AuthFactorOffer {
  const service = typeof offered === "string" ? fakeFactorService(offered) : offered;
  if (role !== "primary") return { service, role, requirement };
  if (!authIdentifies(service.kind)) throw new Error(`fakeFactorOffer: "${service.kind}" cannot be a primary factor`);
  return { service: service as AuthIdentifyingFactorService, role };
}

/** A registry offering email-OTP as primary and `kinds` as optional seconds. @internal */
export function fakeFactorRegistry(kinds: readonly AuthFactorKind[]): AuthFactorRegistry {
  return createFactorRegistry(fakeFactorStore([]), {
    offered: [fakeFactorOffer("email-otp", "primary"), ...kinds.map((kind) => fakeFactorOffer(kind, "second"))],
  });
}

/** Every offered set with each primary it permits, in a stable order. @internal */
export function authFactorOfferings(): AuthFactorOffering[] {
  return AUTH_FACTOR_SETS.flatMap<AuthFactorOffering>((kinds) => {
    const candidates = kinds.filter((kind) => authIdentifies(kind));
    if (candidates.length === 0) return [{ kinds, primary: undefined }];
    return candidates.map((primary) => ({ kinds, primary }));
  });
}

/** The tagged list `kinds` amounts to under `assignment`, with `primary` declared primary. @internal */
function authFactorOffers(
  kinds: readonly AuthFactorKind[],
  primary: AuthFactorKind | undefined,
  assignment: AuthFactorAssignment,
): AuthFactorOffer[] {
  let seconds = 0;
  return kinds.map((kind) =>
    kind === primary ? fakeFactorOffer(kind, "primary") : fakeFactorOffer(kind, "second", assignment.requirement(seconds++)),
  );
}

/** Every offering crossed with every assignment, in a stable order — the matrix both view units assert across. @internal */
export function authFactorGrid(enrolled: readonly AuthFactorKind[] = []): AuthFactorCell[] {
  const store = fakeFactorStore(enrolled);
  const cells: AuthFactorCell[] = [];
  for (const { kinds, primary } of authFactorOfferings()) {
    for (const assignment of AUTH_FACTOR_ASSIGNMENTS) {
      const offering = kinds.length === 0 ? "none" : kinds.join("+");
      const label = `${offering}${primary === undefined ? "" : ` primary=${primary}`} / ${assignment.label}`;
      const options = { offered: authFactorOffers(kinds, primary, assignment) };
      try {
        cells.push({ label, kinds, primary, assignment, registry: createFactorRegistry(store, options), refusal: null });
      } catch (thrown) {
        cells.push({ label, kinds, primary, assignment, registry: null, refusal: (thrown as Error).message });
      }
    }
  }
  return cells;
}

/** The choices `cell` offers a view, or `null` when the combination is refused. @internal */
export function factorChoices(cell: AuthFactorCell): AuthFactorChoices | null {
  if (cell.registry === null) return null;
  const seconds = cell.registry.seconds;
  return {
    primary: cell.registry.primary.kind,
    stepUp: seconds.map((offer) => offer.service.kind),
    enrollable: seconds.filter((offer) => offer.service.enrolment === "explicit").map((offer) => offer.service.kind),
  };
}

/** What `cell` demands of a user holding the grid's enrolments, or `null` when the combination is refused. @internal */
export async function factorDemand(cell: AuthFactorCell): Promise<AuthFactorResolution | null> {
  if (cell.registry === null) return null;
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
    sessionsInvalidBefore: null,
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
    revokeSessions: async () => ok(true),
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
    removeForUser: async (id) => ok(credentials.some((credential) => credential.id === id)),
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
  return { request: async () => err("unavailable" as const), confirm: async () => err("unavailable" as const), ...overrides };
}

/** Every href map the loaders read, built from the three route builders at their default mounts. @internal */
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
    credentials: fakeAuthCredentialStore([]),
    factors: createFactorRegistry(fakeFactorStore([]), { offered: [{ service: fakeFactorService("email-otp"), role: "primary" }] }),
    enrolments: fakeFactorStore([]),
    signin: fakeAuthSigninFlow(),
    signup: fakeAuthSignupFlow(),
    emailChange: fakeAuthEmailChangeFlow(),
    admin: fakeAdminUserStore(users),
    ...overrides,
  };
}

/** The first-admin claim secret a test deployment is configured with. @internal */
export const FAKE_BOOTSTRAP_SECRET = "bootstrap-secret";

/** The options every loader, action factory and `register*` is called with in a test. @internal */
export function fakeAuthWebOptions(overrides: Partial<AuthWebOptions> = {}): AuthWebOptions {
  const services = fakeAuthServices();
  return {
    resolveServices: () => services,
    paths: fakeAuthWebPaths(),
    icon: fakeAuthIcon,
    now: () => 1_000,
    // Configured, because both halves of the claim page 404 without one — a test wanting that case
    // overrides this with a function answering `undefined`.
    bootstrapSecret: () => FAKE_BOOTSTRAP_SECRET,
    ...overrides,
  };
}
