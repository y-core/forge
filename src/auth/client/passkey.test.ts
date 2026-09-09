import { describe, expect, it } from "bun:test";

import { base64urlDecode, base64urlEncode } from "../../crypto/mod";
import { type FakeElement, FakeEvent, fakeTree, type FakeWindow } from "../../ui/client/test-dom";
import {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_CSRF_HEADER_DEFAULT,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  type PasskeyOutcomeDetail,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";
import {
  ceremonyReason,
  encodeCredential,
  mountPasskey,
  type PasskeyContract,
  type PasskeyRealm,
  readPasskeyContract,
  runPasskeyCeremony,
} from "./passkey";

const OPTIONS_PATH = "/auth/passkey/options";
const VERIFY_PATH = "/auth/passkey/verify";
const OPTIONS_TOKEN = "token-for-options";
const VERIFY_TOKEN = "token-for-verify";

const CEREMONY: PasskeyContract = {
  mode: "authentication",
  optionsPath: OPTIONS_PATH,
  verifyPath: VERIFY_PATH,
  optionsToken: OPTIONS_TOKEN,
  verifyToken: VERIFY_TOKEN,
  csrfHeader: PASSKEY_CSRF_HEADER_DEFAULT,
  redirect: "/account",
};

const buffer = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

/** A finished assertion, shaped as the browser hands one over. */
const ASSERTION = {
  id: "credential-id",
  rawId: buffer(1, 2, 3),
  type: "public-key",
  authenticatorAttachment: "platform",
  getClientExtensionResults: () => ({}),
  response: { clientDataJSON: buffer(4, 5), authenticatorData: buffer(6, 7), signature: buffer(8, 9), userHandle: buffer(10, 11) },
} as unknown as PublicKeyCredential;

/** A finished attestation, on the same terms. */
const ATTESTATION = {
  id: "new-credential",
  rawId: buffer(20, 21),
  type: "public-key",
  authenticatorAttachment: "cross-platform",
  getClientExtensionResults: () => ({}),
  response: { clientDataJSON: buffer(22, 23), attestationObject: buffer(24, 25), getTransports: () => ["internal", "hybrid"] },
} as unknown as PublicKeyCredential;

const REQUEST_OPTIONS = {
  challenge: base64urlEncode(new Uint8Array([100, 101, 102])),
  rpId: "example.test",
  userVerification: "preferred",
  allowCredentials: [{ type: "public-key", id: base64urlEncode(new Uint8Array([200, 201])) }],
};

const CREATION_OPTIONS = {
  challenge: base64urlEncode(new Uint8Array([110, 111])),
  rp: { id: "example.test", name: "Example" },
  user: { id: base64urlEncode(new Uint8Array([210, 211])), name: "a@example.test", displayName: "A" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [{ type: "public-key", id: base64urlEncode(new Uint8Array([220])) }],
};

interface Recorded {
  url: string;
  header: string | undefined;
  body: unknown;
}

/** A realm whose two endpoints answer from `replies`, recording every request and navigation. */
function fakeRealm(options: {
  replies?: Record<string, { status?: number; body?: unknown }>;
  answer?: unknown;
  supported?: boolean;
  header?: string;
}): { realm: PasskeyRealm; requests: Recorded[]; navigations: string[]; calls: Array<{ method: string; options: unknown }> } {
  const requests: Recorded[] = [];
  const navigations: string[] = [];
  const calls: Array<{ method: string; options: unknown }> = [];
  const headerName = options.header ?? PASSKEY_CSRF_HEADER_DEFAULT;

  const answer = (method: string, publicKey: unknown): Promise<never> | Promise<unknown> => {
    calls.push({ method, options: publicKey });
    if (typeof options.answer === "string") {
      const error = new Error(options.answer);
      error.name = options.answer;
      return Promise.reject(error);
    }
    return Promise.resolve(options.answer ?? null);
  };

  const realm: PasskeyRealm = {
    supported: options.supported ?? true,
    credentials: {
      create: (o) => answer("create", o.publicKey) as Promise<Credential | null>,
      get: (o) => answer("get", o.publicKey) as Promise<Credential | null>,
    },
    fetch: (url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      requests.push({ url, header: headers[headerName], body: JSON.parse(String(init.body)) });
      const reply = options.replies?.[url];
      if (!reply) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 }));
    },
    navigate: (path) => {
      navigations.push(path);
    },
  };
  return { realm, requests, navigations, calls };
}

describe("runPasskeyCeremony — the DOM-free ceremony core", () => {
  it("runs an authentication end to end and navigates to the guarded redirect target", async () => {
    const { realm, requests, navigations, calls } = fakeRealm({
      replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS }, [VERIFY_PATH]: { body: { ok: true } } },
      answer: ASSERTION,
    });

    expect(await runPasskeyCeremony(CEREMONY, realm)).toEqual({ mode: "authentication" });
    expect(calls.map((c) => c.method)).toEqual(["get"]);
    expect(navigations).toEqual(["/account"]);

    const publicKey = calls[0]?.options as PublicKeyCredentialRequestOptions;
    expect(new Uint8Array(publicKey.challenge as ArrayBuffer)).toEqual(new Uint8Array([100, 101, 102]));
    expect(new Uint8Array(publicKey.allowCredentials?.[0]?.id as ArrayBuffer)).toEqual(new Uint8Array([200, 201]));

    const posted = requests[1]?.body as { credential: { response: Record<string, string> } };
    expect(posted.credential.response).toEqual({
      clientDataJSON: base64urlEncode(new Uint8Array([4, 5])),
      authenticatorData: base64urlEncode(new Uint8Array([6, 7])),
      signature: base64urlEncode(new Uint8Array([8, 9])),
      userHandle: base64urlEncode(new Uint8Array([10, 11])),
    });
  });

  it("runs a registration end to end, decoding the user handle and the exclude list", async () => {
    const { realm, requests, navigations, calls } = fakeRealm({
      replies: { [OPTIONS_PATH]: { body: CREATION_OPTIONS }, [VERIFY_PATH]: { body: { ok: true } } },
      answer: ATTESTATION,
    });

    const ceremony = { ...CEREMONY, mode: "registration" as const, redirect: "/account/passkeys" };
    expect(await runPasskeyCeremony(ceremony, realm, "Work laptop")).toEqual({ mode: "registration" });
    expect(calls.map((c) => c.method)).toEqual(["create"]);
    expect(navigations).toEqual(["/account/passkeys"]);

    const publicKey = calls[0]?.options as PublicKeyCredentialCreationOptions;
    expect(new Uint8Array(publicKey.user.id as ArrayBuffer)).toEqual(new Uint8Array([210, 211]));
    expect(new Uint8Array(publicKey.excludeCredentials?.[0]?.id as ArrayBuffer)).toEqual(new Uint8Array([220]));

    const posted = requests[1]?.body as { nickname: string; credential: { response: Record<string, unknown> } };
    expect(posted.nickname).toBe("Work laptop");
    expect(posted.credential.response.attestationObject).toBe(base64urlEncode(new Uint8Array([24, 25])));
    expect(posted.credential.response.transports).toEqual(["internal", "hybrid"]);
  });

  it("sends each endpoint its own token and never the other's", async () => {
    const { realm, requests } = fakeRealm({
      replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS }, [VERIFY_PATH]: { body: { ok: true } } },
      answer: ASSERTION,
    });

    await runPasskeyCeremony(CEREMONY, realm);

    expect(requests.map((r) => [r.url, r.header])).toEqual([
      [OPTIONS_PATH, OPTIONS_TOKEN],
      [VERIFY_PATH, VERIFY_TOKEN],
    ]);
  });

  it("sends both tokens on the configured header when the app renamed it", async () => {
    const { realm, requests } = fakeRealm({
      replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS }, [VERIFY_PATH]: { body: { ok: true } } },
      answer: ASSERTION,
      header: "X-Csrf",
    });

    await runPasskeyCeremony({ ...CEREMONY, csrfHeader: "X-Csrf" }, realm);

    expect(requests.map((r) => r.header)).toEqual([OPTIONS_TOKEN, VERIFY_TOKEN]);
  });

  it("refuses an unsupported browser before it asks the server for a challenge", async () => {
    const { realm, requests, calls } = fakeRealm({ supported: false });

    expect(await runPasskeyCeremony(CEREMONY, realm)).toEqual({ mode: "authentication", reason: "unsupported" });
    // The whole point of checking first: a challenge is single-use, and one spent here is one the
    // visitor's next attempt no longer has.
    expect(requests).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reports a dismissed prompt as a stated outcome rather than an unhandled rejection", async () => {
    const { realm, navigations } = fakeRealm({ replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS } }, answer: "NotAllowedError" });

    expect(await runPasskeyCeremony(CEREMONY, realm)).toEqual({ mode: "authentication", reason: "declined" });
    expect(navigations).toEqual([]);
  });

  it("reports an authenticator that already holds a credential as its own reason", async () => {
    const { realm } = fakeRealm({ replies: { [OPTIONS_PATH]: { body: CREATION_OPTIONS } }, answer: "InvalidStateError" });

    expect(await runPasskeyCeremony({ ...CEREMONY, mode: "registration" }, realm)).toEqual({ mode: "registration", reason: "already-enrolled" });
  });

  it("separates a failed options call from a failed verification, and navigates on neither", async () => {
    const noOptions = fakeRealm({ answer: ASSERTION });
    expect(await runPasskeyCeremony(CEREMONY, noOptions.realm)).toEqual({ mode: "authentication", reason: "options-failed" });
    expect(noOptions.calls).toEqual([]);

    const refused = fakeRealm({
      replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS }, [VERIFY_PATH]: { status: 403, body: {} } },
      answer: ASSERTION,
    });
    expect(await runPasskeyCeremony(CEREMONY, refused.realm)).toEqual({ mode: "authentication", reason: "verification-failed" });
    expect(refused.navigations).toEqual([]);
  });

  it("replaces a hostile redirect target with the same-origin fallback", async () => {
    const hostile = ["https://evil.test/steal", "//evil.test/steal", "/\\evil.test", "javascript:alert(1)"];

    for (const redirect of hostile) {
      const { realm, navigations } = fakeRealm({
        replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS }, [VERIFY_PATH]: { body: { ok: true } } },
        answer: ASSERTION,
      });
      await runPasskeyCeremony({ ...CEREMONY, redirect }, realm);
      expect(navigations).toEqual(["/"]);
    }
  });

  it("keeps a same-origin target's query and fragment intact", async () => {
    const { realm, navigations } = fakeRealm({
      replies: { [OPTIONS_PATH]: { body: REQUEST_OPTIONS }, [VERIFY_PATH]: { body: { ok: true } } },
      answer: ASSERTION,
    });

    await runPasskeyCeremony({ ...CEREMONY, redirect: "/account?tab=security#passkeys" }, realm);

    expect(navigations).toEqual(["/account?tab=security#passkeys"]);
  });
});

describe("encodeCredential / ceremonyReason", () => {
  it("round-trips every buffer through base64url", () => {
    const encoded = encodeCredential(ASSERTION);

    expect(encoded.id).toBe("credential-id");
    expect(base64urlDecode(encoded.rawId as string)).toEqual(new Uint8Array([1, 2, 3]));
    expect(encoded.authenticatorAttachment).toBe("platform");
  });

  it("maps only the two named DOMException names, and everything else to one reason", () => {
    const named = (name: string) => Object.assign(new Error(name), { name });

    expect(ceremonyReason(named("NotAllowedError"))).toBe("declined");
    expect(ceremonyReason(named("InvalidStateError"))).toBe("already-enrolled");
    expect(ceremonyReason(named("SecurityError"))).toBe("ceremony-failed");
    expect(ceremonyReason(null)).toBe("ceremony-failed");
  });
});

/** A scope root carrying the full contract, plus the refs the controller addresses. */
function fixture(overrides: Record<string, string> = {}): { root: FakeElement; win: FakeWindow; trigger: FakeElement } {
  const { doc, el } = fakeTree();
  const root = el("DIV", {
    "data-scope": "passkey",
    [PASSKEY_MODE_ATTR]: "authentication",
    [PASSKEY_OPTIONS_PATH_ATTR]: OPTIONS_PATH,
    [PASSKEY_VERIFY_PATH_ATTR]: VERIFY_PATH,
    [PASSKEY_OPTIONS_TOKEN_ATTR]: OPTIONS_TOKEN,
    [PASSKEY_VERIFY_TOKEN_ATTR]: VERIFY_TOKEN,
    [PASSKEY_REDIRECT_ATTR]: "/account",
    ...overrides,
  });
  const trigger = el("BUTTON", { "data-ref": PASSKEY.trigger });
  const status = el("P", { "data-ref": PASSKEY.status });
  const unsupported = el("P", { "data-ref": PASSKEY.unsupported });
  unsupported.hidden = true;
  root.append(trigger, status, unsupported);
  doc.body.append(root);
  return { root, win: doc.defaultView, trigger };
}

describe("readPasskeyContract", () => {
  it("reads the whole contract, defaulting the CSRF header to csrfProtection's own", () => {
    const { root } = fixture();

    expect(readPasskeyContract(root as unknown as HTMLElement)).toEqual(CEREMONY);
  });

  it("takes a renamed CSRF header off the element when the app set one", () => {
    const { root } = fixture({ [PASSKEY_CSRF_HEADER_ATTR]: "X-Csrf" });

    expect(readPasskeyContract(root as unknown as HTMLElement)?.csrfHeader).toBe("X-Csrf");
  });

  it("refuses to mount rather than guess, when a required attribute is missing", () => {
    for (const missing of [PASSKEY_OPTIONS_PATH_ATTR, PASSKEY_VERIFY_PATH_ATTR, PASSKEY_OPTIONS_TOKEN_ATTR, PASSKEY_VERIFY_TOKEN_ATTR]) {
      const { root } = fixture();
      root.removeAttribute(missing);
      expect(readPasskeyContract(root as unknown as HTMLElement)).toBeNull();
    }

    const { root } = fixture({ [PASSKEY_MODE_ATTR]: "sign-in" });
    expect(readPasskeyContract(root as unknown as HTMLElement)).toBeNull();
  });
});

describe("mountPasskey", () => {
  it("says so before the press when the realm has no WebAuthn, and restores on dispose", () => {
    const { root, win, trigger } = fixture();
    win.PublicKeyCredential = undefined;
    const seen: PasskeyOutcomeDetail[] = [];
    root.addEventListener(PASSKEY_OUTCOME_EVENT, (event) => seen.push((event as unknown as CustomEvent<PasskeyOutcomeDetail>).detail));

    const dispose = mountPasskey(root as unknown as HTMLElement);

    const unsupported = root.querySelector(`[data-ref='${PASSKEY.unsupported}']`);
    expect(unsupported?.hidden).toBe(false);
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(win.requests).toEqual([]);

    dispose();
    expect(unsupported?.hidden).toBe(true);
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });

  it("drives a whole ceremony from a press and dispatches the outcome on the scope root", async () => {
    const { root, win, trigger } = fixture();
    win.credentials.answer = ASSERTION;
    win.replies.set(OPTIONS_PATH, { body: REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { body: { ok: true } });
    const seen: PasskeyOutcomeDetail[] = [];
    root.addEventListener(PASSKEY_OUTCOME_EVENT, (event) => seen.push((event as unknown as CustomEvent<PasskeyOutcomeDetail>).detail));

    const dispose = mountPasskey(root as unknown as HTMLElement);
    trigger.dispatchEvent(new FakeEvent("click"));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(win.credentials.calls.map((c) => c.method)).toEqual(["get"]);
    expect(win.requests.map((r) => r.url)).toEqual([OPTIONS_PATH, VERIFY_PATH]);
    expect(win.navigations).toEqual(["/account"]);
    expect(seen).toEqual([{ mode: "authentication" }]);
    dispose();
  });

  it("stops driving ceremonies once disposed", async () => {
    const { root, win, trigger } = fixture();
    win.credentials.answer = ASSERTION;
    win.replies.set(OPTIONS_PATH, { body: REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { body: { ok: true } });

    mountPasskey(root as unknown as HTMLElement)();
    trigger.dispatchEvent(new FakeEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(win.requests).toEqual([]);
  });
});
