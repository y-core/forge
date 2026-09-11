import type { RouteMap } from "@remix-run/fetch-router/routes";
import type { RequestMethod } from "@remix-run/fetch-router/routes";
import type { Route } from "@remix-run/fetch-router/routes";
import type { CreateHrefArgs } from "@remix-run/route-pattern/href";

import type { MiddlewareGuardGroup } from "../../app/types";
import type { PageMeta } from "../../app/types";
import type { AppContext } from "../../context/types";
import type { FC } from "../../jsx/types";
import type { JSXNode } from "../../jsx/types";
import type { ForgeIcon } from "../../ui/core/types";
import type { AdminUserService } from "../admin/types";
import type { AuthFactorRegistry } from "../factors/types";
import type { AuthFactorRequirement } from "../factors/types";
import type { AuthEmailChangeFlow } from "../flows/types";
import type { AuthSigninFlow } from "../flows/types";
import type { AuthSignupFlow } from "../flows/types";
import type { UserVerification } from "../passkey/types";
import type { AuthFactorKind } from "../types";
import type { UserStore } from "../types";
import type { AdminUserOutcome } from "../types";
import type { AuthAlgorithm } from "../types";
import type { ChallengeStore } from "../types";
import type { CredentialStore } from "../types";
import type { FactorStore } from "../types";
import type { AUTH_VIEW_GUARDS } from "./resolve";
import type { accountRoutes } from "./routes";
import type { adminRoutes } from "./routes";
import type { authRoutes } from "./routes";
import type { AdminElevateViewProps } from "./views/types";
import type { AdminUserEditViewProps } from "./views/types";
import type { AdminUsersViewProps } from "./views/types";
import type { AuthFactorsViewProps } from "./views/types";
import type { EmailChangeViewProps } from "./views/types";
import type { PasskeyEditViewProps } from "./views/types";
import type { PasskeyEnrolViewProps } from "./views/types";
import type { PasskeyListViewProps } from "./views/types";
import type { SigninViewProps } from "./views/types";
import type { SignupViewProps } from "./views/types";
import type { TotpEnrolViewProps } from "./views/types";
import type { VerifyViewProps } from "./views/types";

// The same lifetime `AuthWebOptions.resolveServices` has, for the same reason: a store built from a
// Worker binding cannot exist until there is a request carrying `env`.
/** Builds one of a guard's dependencies from the request it is guarding. @public */
export type AuthGuardResolver<Bindings, T> = (c: AppContext<Bindings>) => T | Promise<T>;

/** What `requireAuth` needs to turn a session into an identity. @public */
export interface AuthGuardOptions<Bindings = Record<string, unknown>> {
  /** Built per request, and so re-read every request: a demotion or deactivation lands on the next one rather than the next sign-in. */
  readonly users: AuthGuardResolver<Bindings, Pick<UserStore, "findById">>;
  /** Where an anonymous request is sent — read off `authPaths`, never written as a literal. */
  readonly signinPath: string;
  /** Query parameter carrying the return-to path onto the sign-in page. Defaults to `next`. */
  readonly returnParam?: string;
  /** How this group answers. A `json` group is refused with a body rather than redirected. Defaults to `html`. */
  readonly medium?: AuthMedium;
  /** This request's clock, which the absolute session lifetime is measured against. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** What the two enrolment guards need to tell an owed enrolment from an owed step-up from neither. @public */
export interface AuthEnrolmentGuardOptions<Bindings = Record<string, unknown>> {
  /** Built per request, for the same reason the user store is: the registry is assembled from Worker bindings. */
  readonly factors: AuthGuardResolver<Bindings, Pick<AuthFactorRegistry, "resolve">>;
  // Keyed by kind because the demand is: a deployment offering the authenticator app owes a page an
  // enrolment can be completed on, and a single path sends every owed kind to whichever one it names.
  /** Where a user who still owes an enrolment is sent, by the kind they owe — spell it `authEnrolmentPaths(paths.auth)`. */
  readonly enrolmentPaths: Partial<Record<AuthFactorKind, string>>;
  /** Where a user who owes a step-up is sent — read off `authPaths`. */
  readonly stepUpPath: string;
  /** Where a user with nothing outstanding is sent off an enrolment page — read off `authPaths`. */
  readonly settledPath: string;
  /** How long a completed step-up satisfies a later demand, in milliseconds. Omit to last the session. */
  readonly stepUpMaxAgeMs?: number;
  // Separate from `stepUpMaxAgeMs` because they answer different questions: that one is how long a
  // session stays signed in, this one is how recently the visitor proved they are still there.
  /** How recent a step-up a state-changing request must carry, in milliseconds. Defaults to `AUTH_FRESH_STEP_UP_MS`; `null` and `requireFreshStepUp` demands nothing. */
  readonly freshStepUpMaxAgeMs?: number | null;
  /** How this group answers. A `json` group is refused with a body rather than redirected. Defaults to `html`. */
  readonly medium?: AuthMedium;
  /** This request's clock, which the absolute session lifetime is measured against. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The built route maps a guard chain attaches to; a builder that was never called is simply absent. @public */
export interface AuthRouteMaps {
  readonly auth?: RouteMap;
  readonly account?: RouteMap;
  readonly admin?: RouteMap;
}

/** What `createAuthGuards` needs to wire `AUTH_ROUTE_GROUPS` onto a middleware chain. @public */
export interface AuthGuardChainOptions<Bindings = Record<string, unknown>> {
  readonly routes: AuthRouteMaps;
  readonly auth: AuthGuardOptions<Bindings>;
  readonly enrolment: AuthEnrolmentGuardOptions<Bindings>;
  /** Group table to wire. Defaults to `AUTH_ROUTE_GROUPS`. */
  readonly groups?: readonly AuthRouteGroup[];
  // Reached through `MiddlewareGuardGroup` rather than imported from `security/types`: `auth/web`
  // declares no edge to `security`, and the direct import fails `validate-namespace-graph`.
  /** Origin/Referer allowlist for every group carrying a mutating leaf; forge cannot pick your origins, so without it none is mounted. */
  readonly origin?: NonNullable<MiddlewareGuardGroup<Bindings>["origin"]>;
  // Keyed by the group's own dotted path rather than attached to `AuthRouteGroup`, so the group
  // table stays the one description of what a group *is* and a consumer never restates it. A window
  // right for the sign-in POST is wrong for the admin console, so this is per group and not global.
  /** Rate limits per group, keyed by `path.join(".")` — `"auth"`, `"auth.verify"`, `"account"`. Forge picks no numbers. */
  readonly rateLimit?: Readonly<Record<string, NonNullable<MiddlewareGuardGroup<Bindings>["rateLimit"]>>>;
}

/** Who the request is, established from the session and re-read from the user store every request. @public */
export interface AuthIdentity {
  readonly userId: string;
  readonly email: string;
  readonly isAdmin: boolean;
  /** When this session completed a step-up verification, or `null` when it has not. */
  readonly stepUpAt: number | null;
}

/** The sprite symbols forge's own auth pages draw from. @public */
export type AuthIconName = "alert" | "chevron-right" | "key" | "mail";

// The discoverable sign-in has no user to name, so it cannot run through `AuthFactorService`, whose
// `createChallenge` takes a `userId`. These are the parts the ceremony builders need instead.
/** What a passkey ceremony is held against on this request; absent when the deployment offers no passkey. @public */
export interface AuthPasskeyCeremonyOptions {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
  /** The session the challenge is bound to, so a challenge issued to one visitor cannot be answered by another. */
  readonly sessionId: string;
  readonly challenges: ChallengeStore;
  readonly algorithms?: readonly AuthAlgorithm[];
  readonly ttlSeconds?: number;
  // The stronger posture was unreachable: a discoverable sign-in ran at forge's own defaults with no
  // way to raise them, while `createPasskeyFactor` picks its own per role.
  /** What the authenticator is asked for. Defaults to `preferred`, which admits an authenticator that cannot verify a user. */
  readonly userVerification?: UserVerification;
  /** Whether an assertion that did not verify the user is refused. Defaults to `false`, so asking is not requiring. */
  readonly requireUserVerification?: boolean;
}

/** The domain services one auth request runs against, built per request because a ceremony is bound to its session. @public */
export interface AuthRequestServices {
  readonly users: UserStore;
  readonly credentials: CredentialStore;
  readonly factors: AuthFactorRegistry;
  /** The enrolment rows themselves, which the registry keeps private and the account pages must delete. */
  readonly enrolments: FactorStore;
  readonly signin: AuthSigninFlow;
  readonly signup: AuthSignupFlow;
  readonly emailChange: AuthEmailChangeFlow;
  readonly admin: AdminUserService;
  readonly passkey?: AuthPasskeyCeremonyOptions | undefined;
}

/** The three href maps every loader and action reads its targets off, so no path literal is written twice. @public */
export interface AuthWebPaths {
  readonly auth: AuthEntryPaths;
  readonly account: AuthAccountPaths;
  readonly admin: AuthAdminPaths;
}

/** What every loader, action factory and `register*` needs. @public */
export interface AuthWebOptions<Bindings = Record<string, unknown>> {
  /** Builds this request's services; per request because a passkey ceremony is bound to its session. */
  readonly resolveServices: (c: AppContext<Bindings>) => AuthRequestServices | Promise<AuthRequestServices>;
  readonly paths: AuthWebPaths;
  readonly icon: ForgeIcon<AuthIconName>;
  /** Markup a consumer replaces page by page; an entry receives exactly the props forge's own view does. */
  readonly views?: AuthViews | undefined;
  /** Where a settled sign-in lands when the request carried no return-to. Defaults to the passkey page. */
  readonly settledPath?: string | undefined;
  /** Query parameter carrying the return-to path. Defaults to `next`. */
  readonly returnParam?: string | undefined;
  /** The clock every flow call is made against. Defaults to `Date.now`. */
  readonly now?: (() => number) | undefined;
}

/** Refusal copy and kept input one page render carries; the view owns everything else it says. @public */
export interface AuthPageState {
  /** The value the visitor already typed, kept across a refusal. */
  readonly email?: string | undefined;
  /** A refusal about one field, in the web layer's words. */
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole. */
  readonly error?: string | undefined;
  /** The address a confirmation has just gone out to. */
  readonly sentTo?: string | undefined;
  /** What an administrative write last reported for the account being rendered. */
  readonly outcome?: AdminUserOutcome | undefined;
  readonly status?: number | undefined;
}

/** A route map mirrored as href builders — one per leaf, nested maps preserved. @public */
export type AuthPathMap<routes extends RouteMap> = {
  readonly [name in keyof routes]: routes[name] extends Route<RequestMethod | "ANY", infer pattern extends string>
    ? (...args: CreateHrefArgs<pattern>) => string
    : routes[name] extends RouteMap
      ? AuthPathMap<routes[name]>
      : never;
};

/** The href readers `authRoutes` produces, named so a loader can take them as one prop. @public */
export type AuthEntryPaths<base extends string = string> = AuthPathMap<ReturnType<typeof authRoutes<base>>>;

/** The href readers `accountRoutes` produces, named so a view can take them as one prop. @public */
export type AuthAccountPaths<base extends string = string> = AuthPathMap<ReturnType<typeof accountRoutes<base>>>;

/** The href readers `adminRoutes` produces, named so a view can take them as one prop. @public */
export type AuthAdminPaths<base extends string = string> = AuthPathMap<ReturnType<typeof adminRoutes<base>>>;

/** The props each page name's view receives — what a `views` override is held to. @public */
export interface AuthViewProps {
  readonly signin: SigninViewProps;
  readonly signup: SignupViewProps;
  readonly verify: VerifyViewProps;
  readonly enrolPasskey: PasskeyEnrolViewProps;
  readonly enrolTotp: TotpEnrolViewProps;
  readonly accountPasskeys: PasskeyListViewProps;
  readonly accountPasskey: PasskeyListViewProps;
  readonly accountPasskeyEdit: PasskeyEditViewProps;
  readonly accountTotp: TotpEnrolViewProps;
  readonly accountEmailChange: EmailChangeViewProps;
  readonly accountFactors: AuthFactorsViewProps;
  readonly adminUsers: AdminUsersViewProps;
  readonly adminUser: AdminUserEditViewProps;
  readonly adminUserEdit: AdminUserEditViewProps;
  readonly adminUserFactors: AuthFactorsViewProps;
  readonly adminElevate: AdminElevateViewProps;
}

/** Which auth page a render is for — one name per HTML page the route builders serve. @public */
export type AuthViewName = keyof AuthViewProps;

/** Per-page markup a consumer may replace; an entry receives exactly the props forge's own view does. @public */
export type AuthViews = { readonly [Name in AuthViewName]?: FC<AuthViewProps[Name]> };

/** What `renderAuthPage` needs to turn one page's data into the medium the request asked for. @public */
export interface AuthPageOptions<Name extends AuthViewName> {
  readonly name: Name;
  /** Markup for this page, ahead of `AUTH_VIEWS` and behind a `views` entry for `name`. */
  readonly view?: FC<AuthViewProps[Name]>;
  readonly props: AuthViewProps[Name];
  readonly views?: AuthViews;
  /** Merged over the descriptor forge gives this page — a title, a canonical, an `og` field. */
  readonly meta?: Partial<PageMeta>;
  readonly status?: number;
  readonly headers?: Record<string, string>;
}

/** Which factor the verify page is asking for, and whose account it is asking about. @internal */
export interface AuthVerifyDemand {
  readonly factor: AuthFactorKind;
  /** How many digits the presented factor's code has, or `null` when it is answered by a ceremony. */
  readonly digits: number | null;
  /** The signed-in identity owing a step-up, or `null` when this is the second half of a sign-in. */
  readonly identity: AuthIdentity | null;
  // What an established identity actually owes, which is not always a step-up. Rendering the code
  // field for anything else builds a form the submit cannot accept: `signin.stepUp` refuses the
  // primary factor by design, so a page that fell back to it asks for a code nothing will verify.
  /** What the resolution demanded of an established identity; `null` when there is no identity to demand of. */
  readonly owed: "step-up" | "enrolment" | "none" | "unknown" | null;
  /** The kinds an owed enrolment may be completed with, empty unless `owed` is `enrolment`. */
  readonly kinds: readonly AuthFactorKind[];
}

/** One auth view resolved against this request. @public */
export interface AuthViewResolved<Name extends AuthViewName> {
  readonly name: Name;
  /** The resolved props — the escape hatch, for a host composing its own markup. */
  readonly props: AuthViewProps[Name];
  /** `props` applied to `views[name] ?? forge's own view`. The ergonomic path. */
  readonly node: JSXNode;
  /** The status this render carries; `undefined` means 200. */
  readonly status: number | undefined;
}

/** What to resolve, and the caller's claim about the guards its route runs. @public */
export interface AuthViewRequest<Name extends AuthViewName> {
  readonly name: Name;
  readonly state?: AuthPageState | undefined;
  /** The guards this route runs. Required for a guarded page; spell it `AUTH_VIEW_GUARDS.adminUsers`. */
  readonly guarded?: (typeof AUTH_VIEW_GUARDS)[Name];
}

/** The body a route group answers with. @public */
export type AuthMedium = "html" | "json";

/** A guard carried by a route group's middleware stack. @public */
export type AuthGuardName =
  | "resolve-auth"
  | "require-auth"
  | "require-admin"
  | "require-enrolment"
  | "require-pending-enrolment"
  | "require-fresh-step-up";

/** One middleware group of a built auth route map. @public */
export interface AuthRouteGroup {
  /** Key path of the group, opening with the builder name — `["auth"]` is `authRoutes`' own level. */
  readonly path: readonly string[];
  readonly guards: readonly AuthGuardName[];
  readonly medium: AuthMedium;
}

/** One requirement assignment the factor matrix crosses, read by position among the second factors. @internal */
export interface AuthFactorAssignment {
  /** How the assignment reads in a cell label, e.g. `all-mandatory`. */
  readonly label: string;
  requirement(index: number): AuthFactorRequirement;
}

/** One cell of the factor matrix: an offering crossed with a requirement assignment. @internal */
export interface AuthFactorCell {
  /** How the cell reads in a failure message, e.g. `email-otp+passkey primary=passkey / all-mandatory`. */
  readonly label: string;
  readonly kinds: readonly AuthFactorKind[];
  /** The declared primary, absent only where the offered set has no factor that can be one. */
  readonly primary: AuthFactorKind | undefined;
  readonly assignment: AuthFactorAssignment;
  /** The registry the combination builds, or `null` when `createFactorRegistry` refuses it. */
  readonly registry: AuthFactorRegistry | null;
  /** Why it was refused, or `null` when it was not. */
  readonly refusal: string | null;
}

/** What a view is told about the factors, read off the registry rather than restated. @internal */
export interface AuthFactorChoices {
  /** The one factor that starts a sign-in. Never `totp-app`. */
  readonly primary: AuthFactorKind;
  /** Factors that can satisfy a step-up, in offered order. */
  readonly stepUp: readonly AuthFactorKind[];
  /** Factors a user enrols in deliberately, in offered order. */
  readonly enrollable: readonly AuthFactorKind[];
}

// Every offered set names its primary, and the namings render differently, so the choice is crossed
// rather than defaulted — a set with nothing primary-capable names none and is refused.
/** One offered set together with the primary it is declared with. @internal */
export interface AuthFactorOffering {
  readonly kinds: readonly AuthFactorKind[];
  /** The declared primary, absent only where the offered set has no factor that can be one. */
  readonly primary: AuthFactorKind | undefined;
}
