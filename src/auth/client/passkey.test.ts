import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { base64urlDecode, base64urlEncode } from "../../crypto/primitives/mod";
import { FakeEvent, fakeTree } from "../../ui/client/dom.fixture";
import type { FakeElement, FakeWindow } from "../../ui/client/dom.fixture";
import { ANNOUNCER_REGION_SLOTS } from "../../ui/contracts/announcer-contract";
import {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_CSRF_HEADER_DEFAULT,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";
import type { PasskeyOutcomeDetail } from "../types";
import { ceremonyReason, encodeCredential, mountPasskey, onPasskeyPrf, passkeyPrfOutput, readPasskeyContract, runPasskeyCeremony } from "./passkey";
import type { PasskeyContract, PasskeyPrfHandler, PasskeyPrfResult, PasskeyRealm } from "./types";

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

  it("carries no client extension results, so PRF and largeBlob output never reaches the server", () => {
    const secret = new Uint8Array(32).fill(0xab);
    const withExtensions = {
      ...ASSERTION,
      response: ASSERTION.response,
      getClientExtensionResults: () => ({ prf: { results: { first: secret } }, largeBlob: { blob: secret } }),
    } as unknown as PublicKeyCredential;

    const body = JSON.stringify(encodeCredential(withExtensions));

    expect(body).not.toContain("clientExtensionResults");
    expect(body).not.toContain("prf");
    expect(body).not.toContain("largeBlob");
    expect(body).not.toContain(base64urlEncode(secret).slice(0, 16));
  });

  it("maps only the two named DOMException names, and everything else to one reason", () => {
    const named = (name: string) => Object.assign(new Error(name), { name });

    expect(ceremonyReason(named("NotAllowedError"))).toBe("declined");
    expect(ceremonyReason(named("InvalidStateError"))).toBe("already-enrolled");
    expect(ceremonyReason(named("SecurityError"))).toBe("ceremony-failed");
    expect(ceremonyReason(null)).toBe("ceremony-failed");
  });
});

/** A scope root carrying the full contract, plus the refs the controller addresses, beside an `<Announcer />`'s regions. */
function fixture(overrides: Record<string, string> = {}): {
  root: FakeElement;
  win: FakeWindow;
  trigger: FakeElement;
  polite: FakeElement;
  assertive: FakeElement;
} {
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
  const polite = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.polite });
  const assertive = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.assertive });
  doc.root.append(polite, assertive);
  return { root, win: doc.defaultView, trigger, polite, assertive };
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

  it("runs one ceremony for a double press, since the second would abort the first", async () => {
    const { root, win, trigger } = fixture();
    win.credentials.answer = ASSERTION;
    win.replies.set(OPTIONS_PATH, { body: REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { body: { ok: true } });

    const dispose = mountPasskey(root as unknown as HTMLElement);
    trigger.dispatchEvent(new FakeEvent("click"));
    trigger.dispatchEvent(new FakeEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(win.credentials.calls.map((c) => c.method)).toEqual(["get"]);
    expect(win.requests.map((r) => r.url)).toEqual([OPTIONS_PATH, VERIFY_PATH]);
    dispose();
  });

  it("clears the busy state even when the ceremony throws outside its own try", async () => {
    const { root, win, trigger } = fixture();
    win.credentials.answer = ASSERTION;
    win.replies.set(OPTIONS_PATH, { body: REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { body: { ok: true } });
    win.location.assign = () => {
      throw new Error("navigation refused");
    };

    const seen: PasskeyOutcomeDetail[] = [];
    root.addEventListener(PASSKEY_OUTCOME_EVENT, (event) => seen.push((event as unknown as CustomEvent<PasskeyOutcomeDetail>).detail));

    const dispose = mountPasskey(root as unknown as HTMLElement);
    trigger.dispatchEvent(new FakeEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([{ mode: "authentication", reason: "ceremony-failed" }]);
    expect(trigger.hasAttribute("aria-busy")).toBe(false);
    trigger.dispatchEvent(new FakeEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(win.credentials.calls.map((c) => c.method)).toEqual(["get", "get"]);
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

describe("mountPasskey — the outcome is spoken through the page's announcer", () => {
  const spoken = (region: FakeElement): string[] => region.children.map((node) => node.textContent);

  it("interrupts with the unsupported message at mount, before any press", () => {
    const { root, win, polite, assertive } = fixture();
    win.PublicKeyCredential = undefined;

    const dispose = mountPasskey(root as unknown as HTMLElement);
    win.flush();

    expect(spoken(assertive)).toEqual([
      "This browser cannot use passkeys. Please try again in a current version of Chrome, Edge, Firefox or Safari.",
    ]);
    expect(spoken(polite)).toEqual([]);
    dispose();
  });

  it("announces a success politely", async () => {
    const { root, win, trigger, polite, assertive } = fixture();
    win.credentials.answer = ASSERTION;
    win.replies.set(OPTIONS_PATH, { body: REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { body: { ok: true } });

    const dispose = mountPasskey(root as unknown as HTMLElement);
    trigger.dispatchEvent(new FakeEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    win.flush();

    expect(spoken(polite)).toEqual(["Passkey accepted. Signing you in."]);
    expect(spoken(assertive)).toEqual([]);
    dispose();
  });

  it("interrupts with a refusal, and speaks the same refusal again on a second press", async () => {
    const { root, win, trigger, polite, assertive } = fixture();
    win.credentials.answer = ASSERTION;
    win.replies.set(OPTIONS_PATH, { body: REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { status: 403, body: {} });

    const appended: string[] = [];
    const append = assertive.append.bind(assertive);
    assertive.append = (...nodes: FakeElement[]) => {
      appended.push(...nodes.map((node) => node.textContent));
      return append(...nodes);
    };

    const dispose = mountPasskey(root as unknown as HTMLElement);
    const press = async () => {
      trigger.dispatchEvent(new FakeEvent("click"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      win.flush();
    };
    await press();
    await press();

    const refused = "That passkey wasn't accepted. Please try again.";
    expect(appended).toEqual([refused, refused]);
    expect(spoken(polite)).toEqual([]);
    expect(root.querySelector(`[data-ref='${PASSKEY.status}']`)?.textContent).toBe(refused);
    dispose();
  });
});

const PRF_SALT = [7, 8, 9];
const OTHER_PRF_SALT = [4, 5];
const PRF_OUTPUT = Array.from({ length: 32 }, (_, index) => index + 0xc0);

const withPrf = <T extends object>(credential: T, results: unknown): T => ({ ...credential, getClientExtensionResults: () => results }) as T;

const PRF_REQUEST_OPTIONS = {
  ...REQUEST_OPTIONS,
  extensions: {
    prf: {
      evalByCredential: {
        [REQUEST_OPTIONS.allowCredentials[0]?.id ?? ""]: { first: base64urlEncode(new Uint8Array(PRF_SALT)) },
        "second-credential": { first: base64urlEncode(new Uint8Array(OTHER_PRF_SALT)) },
      },
    },
  },
};

const PRF_CREATION_OPTIONS = { ...CREATION_OPTIONS, extensions: { prf: { eval: { first: base64urlEncode(new Uint8Array(PRF_SALT)) } } } };

const REGISTRATION: PasskeyContract = { ...CEREMONY, mode: "registration", redirect: "/account/passkeys" };

const prfDisposers: Array<() => void> = [];

function handlePrf(handler: PasskeyPrfHandler): () => void {
  const dispose = onPasskeyPrf(handler);
  prfDisposers.push(dispose);
  return dispose;
}

afterEach(() => {
  for (const dispose of prfDisposers.splice(0)) dispose();
});

/** A ceremony whose options and verification both answer, with `answer` as the credential. */
function answering(options: unknown, answer: unknown, verifyStatus = 200) {
  return fakeRealm({ replies: { [OPTIONS_PATH]: { body: options }, [VERIFY_PATH]: { status: verifyStatus, body: { ok: true } } }, answer });
}

describe("runPasskeyCeremony — PRF salts reach the authenticator as bytes", () => {
  it("hands `create` the registration salt decoded to bytes", async () => {
    const { realm, calls } = answering(PRF_CREATION_OPTIONS, ATTESTATION);

    await runPasskeyCeremony(REGISTRATION, realm);

    const publicKey = calls[0]?.options as PublicKeyCredentialCreationOptions;
    expect(new Uint8Array(publicKey.extensions?.prf?.eval?.first as ArrayBuffer)).toEqual(new Uint8Array(PRF_SALT));
  });

  it("hands `get` each step-up salt as bytes, keyed by the credential id string the allow-list is matched on", async () => {
    const { realm, calls } = answering(PRF_REQUEST_OPTIONS, ASSERTION);

    await runPasskeyCeremony(CEREMONY, realm);

    const byCredential = (calls[0]?.options as PublicKeyCredentialRequestOptions | undefined)?.extensions?.prf?.evalByCredential ?? {};
    expect(Object.entries(byCredential).map(([id, salt]) => [id, [...new Uint8Array(salt.first as ArrayBuffer)]])).toEqual([
      ["yMk", PRF_SALT],
      ["second-credential", OTHER_PRF_SALT],
    ]);
  });

  it("gives neither ceremony an `extensions` key, nor calls the handler, when the server named no PRF salt", async () => {
    for (const extensions of [undefined, { prf: {} }]) {
      const registration = answering({ ...CREATION_OPTIONS, extensions }, ATTESTATION);
      const authentication = answering({ ...REQUEST_OPTIONS, extensions }, ASSERTION);
      const results: PasskeyPrfResult[] = [];
      const dispose = handlePrf((result) => {
        results.push(result);
      });

      await runPasskeyCeremony(REGISTRATION, registration.realm);
      await runPasskeyCeremony(CEREMONY, authentication.realm);
      dispose();

      expect({
        extensions,
        keyed: [registration.calls[0]?.options, authentication.calls[0]?.options].map((o) => Object.hasOwn(o as object, "extensions")),
        results,
      }).toEqual({ extensions, keyed: [false, false], results: [] });
    }
  });
});

describe("onPasskeyPrf — the page receives the output before it navigates", () => {
  it("hands the handler the mode, the credential id and the 32-byte output after verification and before navigation", async () => {
    const { realm, requests, navigations } = answering(
      PRF_REQUEST_OPTIONS,
      withPrf(ASSERTION, { prf: { results: { first: new Uint8Array(PRF_OUTPUT).buffer } } }),
    );
    const seen: Array<{ result: PasskeyPrfResult; posted: string[]; navigated: string[] }> = [];
    handlePrf((result) => {
      seen.push({ result, posted: requests.map((r) => r.url), navigated: [...navigations] });
    });

    expect(await runPasskeyCeremony(CEREMONY, realm)).toEqual({ mode: "authentication" });

    expect(seen).toEqual([
      {
        result: { mode: "authentication", credentialId: "credential-id", output: new Uint8Array(PRF_OUTPUT) },
        posted: [OPTIONS_PATH, VERIFY_PATH],
        navigated: [],
      },
    ]);
    expect(navigations).toEqual(["/account"]);
  });

  it("awaits an async handler before it navigates", async () => {
    const { realm, navigations } = answering(
      PRF_CREATION_OPTIONS,
      withPrf(ATTESTATION, { prf: { enabled: true, results: { first: new Uint8Array(PRF_OUTPUT).buffer } } }),
    );
    const navigatedWhenSettled: string[][] = [];
    handlePrf(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      navigatedWhenSettled.push([...navigations]);
    });

    await runPasskeyCeremony(REGISTRATION, realm);

    expect({ navigatedWhenSettled, navigations }).toEqual({ navigatedWhenSettled: [[]], navigations: ["/account/passkeys"] });
  });

  it("hands `output: null` when PRF was asked for but no real 32-byte result came back", async () => {
    const cases = [
      { label: "enabled only", results: { prf: { enabled: true } } },
      { label: "16 bytes", results: { prf: { results: { first: new Uint8Array(16).fill(1).buffer } } } },
      { label: "no prf at all", results: {} },
    ];
    for (const { label, results } of cases) {
      const { realm } = answering(PRF_CREATION_OPTIONS, withPrf(ATTESTATION, results));
      const outputs: Array<Uint8Array | null> = [];
      const dispose = handlePrf((result) => {
        outputs.push(result.output);
      });

      await runPasskeyCeremony(REGISTRATION, realm);
      dispose();

      expect({ label, outputs }).toEqual({ label, outputs: [null] });
    }
  });

  it("does not call the handler when the options asked for no PRF, whatever the credential carries", async () => {
    const { realm, navigations } = answering(
      REQUEST_OPTIONS,
      withPrf(ASSERTION, { prf: { results: { first: new Uint8Array(PRF_OUTPUT).buffer } } }),
    );
    const results: PasskeyPrfResult[] = [];
    handlePrf((result) => {
      results.push(result);
    });

    await runPasskeyCeremony(CEREMONY, realm);

    expect({ results, navigations }).toEqual({ results: [], navigations: ["/account"] });
  });

  it("does not call the handler when the server refused the verification", async () => {
    const { realm } = answering(PRF_REQUEST_OPTIONS, withPrf(ASSERTION, { prf: { results: { first: new Uint8Array(PRF_OUTPUT).buffer } } }), 403);
    const results: PasskeyPrfResult[] = [];
    handlePrf((result) => {
      results.push(result);
    });

    expect(await runPasskeyCeremony(CEREMONY, realm)).toEqual({ mode: "authentication", reason: "verification-failed" });
    expect(results).toEqual([]);
  });

  it("still succeeds and navigates when the handler throws or rejects, and warns once", async () => {
    const failing: Array<{ label: string; handler: PasskeyPrfHandler }> = [
      {
        label: "throws",
        handler: () => {
          throw new Error("unwrap failed");
        },
      },
      { label: "rejects", handler: () => Promise.reject(new Error("unwrap failed")) },
    ];
    for (const { label, handler } of failing) {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { realm, navigations } = answering(
          PRF_REQUEST_OPTIONS,
          withPrf(ASSERTION, { prf: { results: { first: new Uint8Array(PRF_OUTPUT).buffer } } }),
        );
        const dispose = handlePrf(handler);

        const outcome = await runPasskeyCeremony(CEREMONY, realm);
        dispose();

        expect({ label, outcome, navigations, warned: warn.mock.calls.length }).toEqual({
          label,
          outcome: { mode: "authentication" },
          navigations: ["/account"],
          warned: 1,
        });
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("stops calling a handler once it is disposed", async () => {
    const { realm } = answering(PRF_REQUEST_OPTIONS, ASSERTION);
    const results: PasskeyPrfResult[] = [];
    handlePrf((result) => {
      results.push(result);
    })();

    await runPasskeyCeremony(CEREMONY, realm);

    expect(results).toEqual([]);
  });

  it("lets the last handler registered win, and a stale disposer leave the newer one in place", async () => {
    const calls: string[] = [];
    const disposeFirst = handlePrf(() => {
      calls.push("first");
    });
    handlePrf(() => {
      calls.push("second");
    });
    disposeFirst();

    await runPasskeyCeremony(CEREMONY, answering(PRF_REQUEST_OPTIONS, ASSERTION).realm);

    expect(calls).toEqual(["second"]);
  });
});

describe("passkeyPrfOutput", () => {
  const carrying = (first: unknown) => withPrf(ASSERTION, { prf: { results: { first } } });

  it("copies a 32-byte ArrayBuffer, so a later write to the source does not reach the result", () => {
    const source = new Uint8Array(PRF_OUTPUT);

    const output = passkeyPrfOutput(carrying(source.buffer));
    source.fill(0);

    expect(output).toEqual(new Uint8Array(PRF_OUTPUT));
  });

  it("reads a view at a non-zero offset as exactly its own 32 bytes", () => {
    const backing = new Uint8Array(40).fill(0xee);
    backing.set(PRF_OUTPUT, 4);

    const output = passkeyPrfOutput(carrying(new Uint8Array(backing.buffer, 4, 32)));

    expect({ output, backing: output?.buffer.byteLength }).toEqual({ output: new Uint8Array(PRF_OUTPUT), backing: 32 });
  });

  it("answers null for any length but 32", () => {
    for (const length of [0, 31, 33, 64]) {
      expect(`${length}: ${passkeyPrfOutput(carrying(new Uint8Array(length).buffer))}`).toBe(`${length}: null`);
    }
  });

  it("answers null for a credential with no `getClientExtensionResults` at all", () => {
    const { getClientExtensionResults: _dropped, ...bare } = ASSERTION as unknown as Record<string, unknown>;

    expect(passkeyPrfOutput(bare as unknown as PublicKeyCredential)).toBeNull();
  });
});

describe("mountPasskey — the PRF output stays in the page", () => {
  it("posts none of the output and puts none of it on the outcome event, while the handler still receives it", async () => {
    const secret = new Uint8Array(32).fill(0xab);
    const { root, win, trigger } = fixture();
    win.credentials.answer = withPrf(ASSERTION, { prf: { enabled: true, results: { first: secret.buffer } } });
    win.replies.set(OPTIONS_PATH, { body: PRF_REQUEST_OPTIONS });
    win.replies.set(VERIFY_PATH, { body: { ok: true } });
    const outputs: Array<Uint8Array | null> = [];
    handlePrf((result) => {
      outputs.push(result.output);
    });
    const seen: PasskeyOutcomeDetail[] = [];
    root.addEventListener(PASSKEY_OUTCOME_EVENT, (event) => seen.push((event as unknown as CustomEvent<PasskeyOutcomeDetail>).detail));

    const dispose = mountPasskey(root as unknown as HTMLElement);
    trigger.dispatchEvent(new FakeEvent("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    dispose();

    const posted = JSON.stringify(win.requests.find((r) => r.url === VERIFY_PATH)?.body);
    expect(outputs).toEqual([secret]);
    expect(seen).toEqual([{ mode: "authentication" }]);
    expect(posted).not.toContain("prf");
    expect(posted).not.toContain(base64urlEncode(secret));
    expect(posted).not.toContain("ab".repeat(32));
    expect(posted).not.toContain(JSON.stringify(Array.from(secret)).slice(1, -1));
  });
});
