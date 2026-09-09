import { base64urlDecode, base64urlEncode } from "../../crypto/mod";
import { safeRedirectPath } from "../../http/redirect-path";
import { ownerWindow } from "../../ui/client/dom";
import {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_CSRF_HEADER_DEFAULT,
  type PasskeyFailureReason,
  PASSKEY_MODE_ATTR,
  type PasskeyMode,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  type PasskeyOutcomeDetail,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_REDIRECT_FALLBACK,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";

/** Everything a ceremony needs, read once off the scope root's contract attributes. @internal */
export interface PasskeyContract {
  mode: PasskeyMode;
  optionsPath: string;
  verifyPath: string;
  optionsToken: string;
  verifyToken: string;
  csrfHeader: string;
  redirect: string;
}

/** The `navigator.credentials` slice a ceremony calls, named so a test can hand over a fake. @internal */
export interface PasskeyCredentials {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

/** The realm capabilities a ceremony needs, taken as an argument so the core is DOM-free. @internal */
export interface PasskeyRealm {
  /** Whether the realm exposes WebAuthn at all — checked before any network call is made. */
  supported: boolean;
  credentials: PasskeyCredentials | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  navigate: (path: string) => void;
}

/** Creation options as JSON: every `BufferSource` field crosses the wire base64url-encoded. */
type CreationOptionsJson = Omit<PublicKeyCredentialCreationOptions, "challenge" | "excludeCredentials" | "user"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: Array<Omit<PublicKeyCredentialDescriptor, "id"> & { id: string }>;
};

/** Request options as JSON, on the same terms. */
type RequestOptionsJson = Omit<PublicKeyCredentialRequestOptions, "allowCredentials" | "challenge"> & {
  challenge: string;
  allowCredentials?: Array<Omit<PublicKeyCredentialDescriptor, "id"> & { id: string }>;
};

const bytes = (value: string): Uint8Array<ArrayBuffer> => base64urlDecode(value);

/** The message shown in the status region for each way a ceremony can end. */
const MESSAGES: Record<PasskeyFailureReason, string> = {
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
  const { challenge, user, excludeCredentials, ...rest } = options;
  return {
    ...rest,
    challenge: bytes(challenge),
    user: { ...user, id: bytes(user.id) },
    ...(excludeCredentials ? { excludeCredentials: excludeCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } : {}),
  };
}

/** The same for request options, whose only credential list is the allow-list. */
function decodeRequest(options: RequestOptionsJson): PublicKeyCredentialRequestOptions {
  const { challenge, allowCredentials, ...rest } = options;
  return {
    ...rest,
    challenge: bytes(challenge),
    ...(allowCredentials ? { allowCredentials: allowCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } : {}),
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
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
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

  let credential: Credential | null;
  try {
    credential =
      mode === "registration"
        ? await realm.credentials.create({ publicKey: decodeCreation(options as CreationOptionsJson) })
        : await realm.credentials.get({ publicKey: decodeRequest(options as RequestOptionsJson) });
  } catch (error) {
    return { mode, reason: ceremonyReason(error) };
  }
  if (!credential) return { mode, reason: "ceremony-failed" };

  const payload = { credential: encodeCredential(credential as PublicKeyCredential), ...(nickname ? { nickname } : {}) };
  const verified = await post(realm, ceremony, ceremony.verifyPath, ceremony.verifyToken, payload);
  if (!verified?.ok) return { mode, reason: "verification-failed" };

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
    if (status && outcome.reason) status.textContent = MESSAGES[outcome.reason];
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
    void runPasskeyCeremony(ceremony, realm, nickname?.value || undefined).then((outcome) => {
      running = false;
      trigger.removeAttribute("aria-busy");
      report(outcome);
    });
  };

  trigger.addEventListener("click", onClick);
  return () => {
    trigger.removeEventListener("click", onClick);
    trigger.removeAttribute("aria-busy");
  };
}
