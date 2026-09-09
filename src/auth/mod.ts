export {
  AUTH_ADMIN_ROLE,
  AUTH_KEY_ID_LENGTH,
  AUTH_PASSKEY_CHALLENGE_BYTES,
  AUTH_PASSKEY_CHALLENGE_MIN_BYTES,
  AUTH_PASSKEY_TTL_SECONDS,
  AUTH_PASSKEY_TTL_MIN_SECONDS,
  AUTH_PASSKEY_TTL_MAX_SECONDS,
  AUTH_KV_MIN_TTL_SECONDS,
  AUTH_OTP_COOLDOWN_MS,
  AUTH_OTP_DIGITS,
  AUTH_OTP_MAX_ATTEMPTS,
  AUTH_OTP_TTL_MS,
  AUTH_SUPPORTED_ALGORITHMS,
} from "./config";
export type { AdminUserService, AdminUserServiceOptions } from "./admin/service";
export { createAdminUserService, isLastAdminRefusal } from "./admin/service";
export type { AttestedCredential, AuthData, AuthDataExpectation, AuthDataFlags, AuthDataReason } from "./passkey/auth-data";
export { verifyAuthData } from "./passkey/auth-data";
export type { ClientData, ClientDataExpectation, ClientDataReason, PasskeyCeremony } from "./passkey/client-data";
export { verifyClientData } from "./passkey/client-data";
export type { EmailOtpOptions } from "./factors/email-otp";
export { createEmailOtpFactor } from "./factors/email-otp";
export type { AuthStoreErrorCode } from "./errors";
export { AuthStoreError } from "./errors";
export { createAdminUserStore } from "./stores/admin-users";
export { createCredentialStore } from "./stores/credentials";
export { createFactorStore } from "./stores/factors";
export { createIdentityLinkStore } from "./stores/identity-links";
export { createUserStore } from "./stores/users";
export type {
  AuthFactorCapabilities,
  AuthFactorChallenge,
  AuthFactorContext,
  AuthFactorPolicy,
  AuthFactorReason,
  AuthFactorRegistry,
  AuthFactorResolution,
  AuthFactorService,
  AuthFactorVerified,
  AuthFactorsOptions,
  EnrollableFactorService,
  ImplicitFactorService,
} from "./factors/registry";
export { authFactorContext, createFactorRegistry } from "./factors/registry";
export type { PasskeyFactorOptions, PasskeyFactorRole, PasskeyFactorSubject } from "./factors/passkey";
export { createPasskeyFactor } from "./factors/passkey";
export type { TotpAppEnrolment, TotpAppFactorOptions } from "./factors/totp-app";
export { createTotpAppFactor } from "./factors/totp-app";
export type { AuthDeferral, AuthFlowChallenge, AuthIssueOutcome } from "./flows/decoy";
export type { AuthEmailChangeFlow, AuthEmailChangeOptions, AuthEmailChangeReason, AuthEmailChangeRequest } from "./flows/email-change";
export { createEmailChangeFlow } from "./flows/email-change";
export type { AuthSignin, AuthSigninFlow, AuthSigninNotice, AuthSigninOptions, AuthSigninReason } from "./flows/signin";
export { createSigninFlow, redactSigninReason } from "./flows/signin";
export type { AuthSignupFlow, AuthSignupOptions } from "./flows/signup";
export { createSignupFlow } from "./flows/signup";
export { authKeyId, importAuthKeyRing, resolveAuthServices } from "./keys/ring";
export type { ChallengeStoreOptions } from "./stores/challenges";
export { createChallengeStore } from "./stores/challenges";
export type { NonceStoreOptions } from "./stores/nonces";
export { createNonceStore } from "./stores/nonces";
export { createOtpStateStore } from "./stores/otp-state";
export type {
  PasskeyCeremonyOptions,
  PasskeyRegistrationOptions,
  PasskeyRegistrationSubject,
  PasskeyRequestOptions,
  PublicKeyCredentialDescriptor,
  PublicKeyCredentialParameter,
  UserVerification,
} from "./passkey/options";
export { createPasskeyRegistrationOptions, createPasskeyRequestOptions } from "./passkey/options";
export type {
  PasskeyAssertionCredential,
  PasskeyAssertionResponse,
  PasskeyAuthentication,
  PasskeyAuthenticationInput,
  PasskeyAuthenticationReason,
  PasskeyAuthenticationVerifyOptions,
} from "./passkey/authenticate";
export { verifyPasskeyAuthentication } from "./passkey/authenticate";
export type {
  PasskeyRegistrationCredential,
  PasskeyRegistrationInput,
  PasskeyRegistrationReason,
  PasskeyRegistrationResponse,
  PasskeyRegistrationVerifyOptions,
} from "./passkey/register";
export { verifyPasskeyRegistration } from "./passkey/register";
export type { PasskeyFailureReason, PasskeyMode, PasskeyOutcomeDetail } from "./passkey-contract";
export {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_CSRF_HEADER_DEFAULT,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_REDIRECT_FALLBACK,
  PASSKEY_SCOPE,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "./passkey-contract";
export { AUTH_TOKEN_VERSION, authNonceKey, decodeAuthToken, encodeAuthToken } from "./keys/token";
export type { AuthTokenClaims, AuthTokenOptions, AuthTokenPurpose, AuthTokenReason } from "./keys/token";
export type {
  AdminUserOutcome,
  AdminUserStore,
  AuthAlgorithm,
  AuthChallenge,
  AuthCredential,
  AuthCredentialInput,
  AuthFactor,
  AuthFactorInput,
  AuthFactorKind,
  AuthIdentityLink,
  AuthIdentityLinkInput,
  AuthKeyRing,
  AuthMessage,
  AuthNotifier,
  AuthOptions,
  AuthSecretResolver,
  AuthServices,
  AuthStoreResult,
  AuthUser,
  AuthUserInput,
  AuthUserPage,
  ChallengeStore,
  CredentialStore,
  FactorStore,
  IdentityLinkStore,
  NonceStore,
  OtpState,
  OtpStateStore,
  UserStore,
} from "./types";
export { normalizeEmail } from "./stores/email";
