import { base64urlDecode, base64urlEncode } from "../../crypto/primitives/mod";
import { safeRedirectPath } from "../../http/redirect-path";
import { announce } from "../../ui/client/announce";
import { ownerWindow } from "../../ui/client/dom";
import {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_CSRF_HEADER_DEFAULT,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_REDIRECT_FALLBACK,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";
import type { PasskeyFailureReason, PasskeyMode, PasskeyOutcomeDetail } from "../types";
import type { PasskeyContract, PasskeyCredentials, PasskeyPrfHandler, PasskeyRealm } from "./types";

type PrfSaltJson = { first: string };

/** Creation options as JSON: every `BufferSource` field crosses the wire base64url-encoded. */
type CreationOptionsJson = Omit<PublicKeyCredentialCreationOptions, "challenge" | "excludeCredentials" | "extensions" | "user"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: Array<Omit<PublicKeyCredentialDescriptor, "id"> & { id: string }>;
  extensions?: { prf?: { eval?: PrfSaltJson } };
};

/** Request options as JSON, on the same terms. */
type RequestOptionsJson = Omit<PublicKeyCredentialRequestOptions, "allowCredentials" | "challenge" | "extensions"> & {
  challenge: string;
  allowCredentials?: Array<Omit<PublicKeyCredentialDescriptor, "id"> & { id: string }>;
  extensions?: { prf?: { evalByCredential?: Record<string, PrfSaltJson> } };
};

const bytes = (value: string): Uint8Array<ArrayBuffer> => base64urlDecode(value);

const PASSKEY_ANNOUNCE_CHANNEL = "passkey";

const PRF_OUTPUT_BYTES = 32;

let prfHandler: PasskeyPrfHandler | null = null;

const SUCCESS_MESSAGES: Record<PasskeyMode, string> = { registration: "Passkey created.", authentication: "Passkey accepted. Signing you in." };

/** The message shown in the status line, and announced, for each way a ceremony can fail. */
const FAILURE_MESSAGES: Record<PasskeyFailureReason, string> = {
  unsupported: "This browser cannot use passkeys. Please try again in a current version of Chrome, Edge, Firefox or Safari.",
  declined: "The passkey prompt was dismissed. Press the button to try again.",
  "already-enrolled": "This device already has a passkey for your account.",
  "options-failed": "Couldn't start the passkey check. Please reload the page and try again.",
  "ceremony-failed": "The passkey couldn't be used on this device. Please try again.",
  "verification-failed": "That passkey wasn't accepted. Please try again.",
};

// Not `ParentNode`, for the reason `dom.ts`'s `queryAcross` is not either.
const ref = (name: string, scope: Element): HTMLElement | null => scope.querySelector<HTMLElement>(`[data-ref='${name}']`);

/** The element at or below `root` carrying `name`; the scope root may itself be the element. */
function findRef(root: HTMLElement, name: string): HTMLElement | null {
  if (root.getAttribute("data-ref") === name) return root;
  return ref(name, root);
}

/** Reads the ceremony a scope root declares, or reports which attribute is missing. @internal */
export function readPasskeyContract(root: HTMLElement): PasskeyContract | null {
  const mode = root.getAttribute(PASSKEY_MODE_ATTR);
  if (mode !== "registration" && mode !== "authentication") {
    console.warn(`[passkey] ${PASSKEY_MODE_ATTR} must be "registration" or "authentication"; the ceremony will not mount`);
    return null;
  }
  const required = {
    optionsPath: PASSKEY_OPTIONS_PATH_ATTR,
    verifyPath: PASSKEY_VERIFY_PATH_ATTR,
    optionsToken: PASSKEY_OPTIONS_TOKEN_ATTR,
    verifyToken: PASSKEY_VERIFY_TOKEN_ATTR,
  } as const;
  const read: Record<string, string> = {};
  for (const [key, attr] of Object.entries(required)) {
    const value = root.getAttribute(attr);
    if (!value) {
      console.warn(`[passkey] no ${attr} on the scope root; the ceremony will not mount`);
      return null;
    }
    read[key] = value;
  }
  return {
    mode,
    optionsPath: read.optionsPath ?? "",
    verifyPath: read.verifyPath ?? "",
    optionsToken: read.optionsToken ?? "",
    verifyToken: read.verifyToken ?? "",
    csrfHeader: root.getAttribute(PASSKEY_CSRF_HEADER_ATTR) || PASSKEY_CSRF_HEADER_DEFAULT,
    redirect: root.getAttribute(PASSKEY_REDIRECT_ATTR) ?? PASSKEY_REDIRECT_FALLBACK,
  };
}

/** Decodes the base64url fields of creation options, by name rather than by a walk over every `id`. */
function decodeCreation(options: CreationOptionsJson): PublicKeyCredentialCreationOptions {
  const { challenge, user, excludeCredentials, extensions, ...rest } = options;
  const prfEval = extensions?.prf?.eval;
  return {
    ...rest,
    challenge: bytes(challenge),
    user: { ...user, id: bytes(user.id) },
    ...(excludeCredentials ? { excludeCredentials: excludeCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } : {}),
    ...(prfEval ? { extensions: { prf: { eval: { first: bytes(prfEval.first) } } } } : {}),
  };
}

/** The same for request options, whose only credential list is the allow-list. */
function decodeRequest(options: RequestOptionsJson): PublicKeyCredentialRequestOptions {
  const { challenge, allowCredentials, extensions, ...rest } = options;
  const evalByCredential = extensions?.prf?.evalByCredential;
  return {
    ...rest,
    challenge: bytes(challenge),
    ...(allowCredentials ? { allowCredentials: allowCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } : {}),
    ...(evalByCredential
      ? {
          extensions: {
            prf: { evalByCredential: Object.fromEntries(Object.entries(evalByCredential).map(([id, v]) => [id, { first: bytes(v.first) }])) },
          },
        }
      : {}),
  };
}

/** Encodes a finished ceremony back to JSON, base64url on every buffer the server has to read. @internal */
export function encodeCredential(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response;
  const attestation = response as Partial<AuthenticatorAttestationResponse>;
  const assertion = response as Partial<AuthenticatorAssertionResponse>;
  const userHandle = assertion.userHandle;
  return {
    id: credential.id,
    rawId: base64urlEncode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: base64urlEncode(response.clientDataJSON),
      ...(attestation.attestationObject ? { attestationObject: base64urlEncode(attestation.attestationObject) } : {}),
      ...(attestation.getTransports ? { transports: attestation.getTransports() } : {}),
      ...(assertion.authenticatorData ? { authenticatorData: base64urlEncode(assertion.authenticatorData) } : {}),
      ...(assertion.signature ? { signature: base64urlEncode(assertion.signature) } : {}),
      ...(userHandle ? { userHandle: base64urlEncode(userHandle) } : {}),
    },
  };
}

/** The 32-byte PRF output a credential carries, or `null`. @internal */
export function passkeyPrfOutput(credential: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  if (typeof credential.getClientExtensionResults !== "function") return null;
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (first === undefined) return null;
  const view = ArrayBuffer.isView(first) ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength) : new Uint8Array(first);
  return view.byteLength === PRF_OUTPUT_BYTES ? view.slice() : null;
}

/** Hands the page each verified ceremony's PRF output before it navigates; the last handler registered wins. @public */
export function onPasskeyPrf(handler: PasskeyPrfHandler): () => void {
  prfHandler = handler;
  return () => {
    if (prfHandler === handler) prfHandler = null;
  };
}

/** Why `navigator.credentials` refused, mapped from the `DOMException` name it threw. @internal */
export function ceremonyReason(error: unknown): PasskeyFailureReason {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError") return "declined";
  if (name === "InvalidStateError") return "already-enrolled";
  return "ceremony-failed";
}

/** Posts `body` to `path` with that path's own CSRF token; a network failure answers `null`. */
async function post(realm: PasskeyRealm, ceremony: PasskeyContract, path: string, token: string, body: unknown): Promise<Response | null> {
  try {
    return await realm.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", [ceremony.csrfHeader]: token },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

/** Runs a whole ceremony against `realm` and reports how it ended; navigates only on success. @internal */
export async function runPasskeyCeremony(ceremony: PasskeyContract, realm: PasskeyRealm, nickname?: string): Promise<PasskeyOutcomeDetail> {
  const mode = ceremony.mode;
  // Before any network call: a browser with no WebAuthn cannot finish, and asking the server for a
  // challenge it will never answer spends a single-use challenge on nothing.
  if (!realm.supported || !realm.credentials) return { mode, reason: "unsupported" };

  const offered = await post(realm, ceremony, ceremony.optionsPath, ceremony.optionsToken, { mode });
  if (!offered?.ok) return { mode, reason: "options-failed" };
  let options: CreationOptionsJson | RequestOptionsJson;
  try {
    options = (await offered.json()) as CreationOptionsJson | RequestOptionsJson;
  } catch {
    return { mode, reason: "options-failed" };
  }

  const publicKey = mode === "registration" ? decodeCreation(options as CreationOptionsJson) : decodeRequest(options as RequestOptionsJson);
  let credential: Credential | null;
  try {
    credential =
      mode === "registration"
        ? await realm.credentials.create({ publicKey: publicKey as PublicKeyCredentialCreationOptions })
        : await realm.credentials.get({ publicKey: publicKey as PublicKeyCredentialRequestOptions });
  } catch (error) {
    return { mode, reason: ceremonyReason(error) };
  }
  if (!credential) return { mode, reason: "ceremony-failed" };

  const payload = { credential: encodeCredential(credential as PublicKeyCredential), ...(nickname ? { nickname } : {}) };
  const verified = await post(realm, ceremony, ceremony.verifyPath, ceremony.verifyToken, payload);
  if (!verified?.ok) return { mode, reason: "verification-failed" };

  if (publicKey.extensions?.prf !== undefined && prfHandler !== null) {
    try {
      await prfHandler({ mode, credentialId: credential.id, output: passkeyPrfOutput(credential as PublicKeyCredential) });
    } catch {
      console.warn("[passkey] the PRF handler threw; the ceremony still succeeded");
    }
  }

  // The target reached the controller on a server-rendered attribute, which is not a trust boundary:
  // the value may have been assembled from a query parameter on the way out.
  realm.navigate(safeRedirectPath(ceremony.redirect, PASSKEY_REDIRECT_FALLBACK));
  return { mode };
}

/** The realm capabilities of the window `root` lives in, so an iframe drives its own ceremony. @internal */
export function realmOf(win: Window): PasskeyRealm {
  return {
    // `PublicKeyCredential` is a global rather than a `Window` member, so it is read off the realm's
    // window by name — which is also what lets a fake realm withhold it.
    supported: typeof (win as { PublicKeyCredential?: unknown }).PublicKeyCredential === "function",
    credentials: win.navigator?.credentials as PasskeyCredentials | undefined,
    fetch: (url, init) => win.fetch(url, init),
    navigate: (path) => {
      win.location.assign(path);
    },
  };
}

/** Mounts the passkey ceremony a scope root declares and returns a cleanup function. */
export function mountPasskey(root: HTMLElement): () => void {
  const ceremony = readPasskeyContract(root);
  if (!ceremony) return () => {};

  const trigger = findRef(root, PASSKEY.trigger);
  if (!trigger) {
    console.warn(`[passkey] no [data-ref="${PASSKEY.trigger}"] under the scope root; there is nothing to start the ceremony`);
    return () => {};
  }

  const status = findRef(root, PASSKEY.status);
  const unsupported = findRef(root, PASSKEY.unsupported);
  const nickname = findRef(root, PASSKEY.nickname) as HTMLInputElement | null;
  const realm = realmOf(ownerWindow(root));

  const report = (outcome: PasskeyOutcomeDetail) => {
    const failed = outcome.reason !== undefined;
    const message = outcome.reason ? FAILURE_MESSAGES[outcome.reason] : SUCCESS_MESSAGES[outcome.mode];
    if (status && failed) status.textContent = message;
    announce(message, { channel: PASSKEY_ANNOUNCE_CHANNEL, politeness: failed ? "assertive" : "polite", repeat: true, within: root });
    root.dispatchEvent(new CustomEvent<PasskeyOutcomeDetail>(PASSKEY_OUTCOME_EVENT, { detail: outcome, bubbles: true }));
  };

  if (!realm.supported) {
    // Revealed at mount rather than on the press: a button that cannot work should say so before it
    // is pressed, not after.
    if (unsupported) unsupported.hidden = false;
    trigger.setAttribute("disabled", "");
    report({ mode: ceremony.mode, reason: "unsupported" });
    return () => {
      if (unsupported) unsupported.hidden = true;
      trigger.removeAttribute("disabled");
    };
  }

  let running = false;
  const onClick = (event: Event) => {
    event.preventDefault();
    // One ceremony at a time: a second `credentials.get` while the first is open aborts it in every
    // browser, which the visitor sees as their own press cancelling itself.
    if (running) return;
    running = true;
    trigger.setAttribute("aria-busy", "true");
    // The encode and navigate steps run outside the ceremony's own try, so a throw there would
    // otherwise leave the button busy and dead for the rest of the page, and say nothing.
    void runPasskeyCeremony(ceremony, realm, nickname?.value || undefined)
      .catch(() => ({ mode: ceremony.mode, reason: "ceremony-failed" }) as PasskeyOutcomeDetail)
      .then(report)
      .finally(() => {
        running = false;
        trigger.removeAttribute("aria-busy");
      });
  };

  trigger.addEventListener("click", onClick);
  return () => {
    trigger.removeEventListener("click", onClick);
    trigger.removeAttribute("aria-busy");
  };
}
