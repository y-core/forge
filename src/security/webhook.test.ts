import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import { base64DecodeOrNull, base64Encode } from "../crypto/base64";
import { randomBytes, utf8Encode } from "../crypto/bytes";
import { importHmacKey } from "../crypto/hmac";
import * as timing from "../crypto/timing";
import type { WebhookSigningOptions } from "./types";
import { computeWebhookSignature, createWebhookSigning } from "./webhook";

const realTimingSafeEqualBytes = timing.timingSafeEqualBytes;
const timingSafeEqualSpy = mock((a: Uint8Array, b: Uint8Array) => realTimingSafeEqualBytes(a, b));
await mock.module("../crypto/timing", () => ({ ...timing, timingSafeEqualBytes: timingSafeEqualSpy }));

const NOW = 1_700_000_000_000;
const now = () => NOW;
const SECRET_OLD = `whsec_${base64Encode(randomBytes(32))}`;
const SECRET_NEXT = `whsec_${base64Encode(randomBytes(32))}`;
const ENDPOINT = "https://receiver.example.com/webhooks";

const realImportKey = crypto.subtle.importKey.bind(crypto.subtle);
let importKeySpy: { mockRestore(): unknown } | undefined;

afterEach(() => {
  importKeySpy?.mockRestore();
  importKeySpy = undefined;
});

type ImportOverride = () => Promise<CryptoKey>;

function recordImports(overrides: (ImportOverride | undefined)[] = [], gate: Promise<void> = Promise.resolve()): Uint8Array[] {
  const imported: Uint8Array[] = [];
  async function importKey(format: "raw", keyData: Uint8Array<ArrayBuffer>, algorithm: HmacImportParams, extractable: boolean, usages: KeyUsage[]) {
    imported.push(new Uint8Array(keyData));
    await gate;
    return overrides.shift()?.() ?? realImportKey(format, keyData, algorithm, extractable, usages);
  }
  importKeySpy = spyOn(crypto.subtle, "importKey").mockImplementation(importKey as unknown as SubtleCrypto["importKey"]);
  return imported;
}

function rawSecret(secret: string): Uint8Array {
  const raw = base64DecodeOrNull(secret.slice("whsec_".length));
  if (raw === null) throw new Error("fixture secret is not base64");
  return raw;
}

const rejectImport: ImportOverride = () => Promise.reject(new Error("import unavailable"));

function signing(options: Partial<WebhookSigningOptions> = {}) {
  return createWebhookSigning({ secrets: [SECRET_OLD], now, ...options });
}

async function signedRequest(
  body: string | Uint8Array<ArrayBuffer>,
  options: { secrets?: string[]; at?: number; id?: string; headers?: Record<string, string> } = {},
): Promise<Request> {
  const signed = await signing({ secrets: options.secrets ?? [SECRET_OLD], now: () => options.at ?? NOW }).sign({
    id: options.id ?? "msg_1",
    body,
  });
  return new Request(ENDPOINT, { method: "POST", body, headers: { ...signed, ...options.headers } });
}

function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error("expected a synchronous throw");
}

function expectMessageOmitsSecret(fn: () => unknown, secret: string, fragment: string): void {
  const message = thrownMessage(fn);
  expect(message).toContain(fragment);
  expect(message).not.toContain(secret);
}

function flipLastBase64Char(signature: string): string {
  const mac = signature.slice(3);
  const last = mac.at(-2) ?? "";
  const replacement = "ABCD".includes(last) ? "Q" : "A";
  return `v1,${mac.slice(0, -2)}${replacement}=`;
}

describe("computeWebhookSignature", () => {
  it("matches the Standard Webhooks reference vector", async () => {
    const raw = base64DecodeOrNull("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
    if (raw === null) throw new Error("fixture secret is not base64");
    const key = await importHmacKey(raw);
    const mac = await computeWebhookSignature(key, {
      id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
      timestamp: 1614265330,
      body: utf8Encode('{"test": 2432232314}'),
    });
    expect(base64Encode(mac)).toBe("g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });
});

describe("createWebhookSigning sign", () => {
  it("refuses the 24-byte reference secret synchronously, without echoing it", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    expectMessageOmitsSecret(() => signing({ secrets: [secret] }), secret, "(got 24)");
    expectMessageOmitsSecret(() => signing({ secrets: [secret] }), secret, "at least 32 bytes");
  });

  it("produces exactly the three Standard Webhooks headers", async () => {
    const signed = await signing().sign({ id: "msg_1", body: "{}" });
    const init: HeadersInit = signed;
    expect(Object.keys(signed).toSorted()).toEqual(["webhook-id", "webhook-signature", "webhook-timestamp"]);
    expect(signed["webhook-id"]).toBe("msg_1");
    expect(signed["webhook-timestamp"]).toBe(String(Math.floor(NOW / 1000)));
    expect(signed["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/);
    expect(new Headers(init).get("webhook-signature")).toBe(signed["webhook-signature"]);
  });

  it("emits one space-separated v1 signature per secret, in order", async () => {
    const both = await signing({ secrets: [SECRET_NEXT, SECRET_OLD] }).sign({ id: "msg_1", body: "{}" });
    const next = await signing({ secrets: [SECRET_NEXT] }).sign({ id: "msg_1", body: "{}" });
    const old = await signing().sign({ id: "msg_1", body: "{}" });
    expect(both["webhook-signature"]).toBe(`${next["webhook-signature"]} ${old["webhook-signature"]}`);
  });

  it("signs a string body and its UTF-8 bytes identically", async () => {
    const body = '{"name":"Zoë"}';
    const fromString = await signing().sign({ id: "msg_1", body });
    const fromBytes = await signing().sign({ id: "msg_1", body: utf8Encode(body) });
    expect(fromBytes["webhook-signature"]).toBe(fromString["webhook-signature"]);
  });

  it("throws synchronously on every misconfiguration, never echoing a secret", () => {
    const short = `whsec_${base64Encode(randomBytes(31))}`;
    const sign = (id: string, secrets: string[]) => () => signing({ secrets }).sign({ id, body: "{}" });
    expect(sign("msg_1", [])).toThrow("createWebhookSigning: secrets is empty");
    expectMessageOmitsSecret(sign("msg_1", ["MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwMfKQ9r8GKYqr"]), "MfKQ9r8GKYqr", "whsec_-prefixed");
    expectMessageOmitsSecret(sign("msg_1", ["whsec_not*base64"]), "not*base64", "whsec_-prefixed");
    expectMessageOmitsSecret(sign("msg_1", [short]), short.slice(6), "at least 32 bytes (got 31)");
    const uniform = `whsec_${base64Encode(new Uint8Array(32).fill(0x2a))}`;
    expectMessageOmitsSecret(sign("msg_1", [uniform]), uniform.slice(6), "all the same value");
    expect(sign("", [SECRET_OLD])).toThrow("sign: id is empty");
    expect(sign("msg.1", [SECRET_OLD])).toThrow('sign: id contains "."');
  });
});

describe("createWebhookSigning verify", () => {
  it("accepts a valid webhook and hands back the exact signed bytes", async () => {
    const body = utf8Encode('{"greeting":"héllo — 世界"}');
    const result = await signing().verify(await signedRequest(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.body).toEqual(body);
    expect(result.data.id).toBe("msg_1");
    expect(result.data.timestamp).toBe(Math.floor(NOW / 1000));
  });

  it("answers signature-mismatch for a tampered body byte", async () => {
    const signed = await signing().sign({ id: "msg_1", body: "{}" });
    const request = new Request(ENDPOINT, { method: "POST", body: "{ ", headers: signed });
    expect(await signing().verify(request)).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("answers signature-mismatch for a tampered id or a timestamp moved within tolerance", async () => {
    const byId = await signedRequest("{}", { headers: { "webhook-id": "msg_2" } });
    const byStamp = await signedRequest("{}", { headers: { "webhook-timestamp": String(Math.floor(NOW / 1000) - 1) } });
    expect(await signing().verify(byId)).toEqual({ ok: false, error: "signature-mismatch" });
    expect(await signing().verify(byStamp)).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("answers signature-mismatch under the wrong secret", async () => {
    const request = await signedRequest("{}");
    expect(await signing({ secrets: [SECRET_NEXT] }).verify(request)).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("answers signature-mismatch when the last significant base64 character changes", async () => {
    const signed = await signing().sign({ id: "msg_1", body: "{}" });
    const tampered = flipLastBase64Char(signed["webhook-signature"]);
    const request = new Request(ENDPOINT, { method: "POST", body: "{}", headers: { ...signed, "webhook-signature": tampered } });
    expect(await signing().verify(request)).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("ignores an entry of another version ahead of a valid v1", async () => {
    const signed = await signing().sign({ id: "msg_1", body: "{}" });
    const header = `v1a,xxx ${signed["webhook-signature"]}`;
    const request = new Request(ENDPOINT, { method: "POST", body: "{}", headers: { ...signed, "webhook-signature": header } });
    expect((await signing().verify(request)).ok).toBe(true);
  });

  it("accepts a timestamp exactly at either edge of the tolerance", async () => {
    const early = await signedRequest("{}", { at: NOW - 300_000 });
    const late = await signedRequest("{}", { at: NOW + 300_000 });
    expect((await signing().verify(early)).ok).toBe(true);
    expect((await signing().verify(late)).ok).toBe(true);
  });

  it("refuses a timestamp one second past either edge", async () => {
    const old = await signedRequest("{}", { at: NOW - 301_000 });
    const future = await signedRequest("{}", { at: NOW + 301_000 });
    expect(await signing().verify(old)).toEqual({ ok: false, error: "timestamp-too-old" });
    expect(await signing().verify(future)).toEqual({ ok: false, error: "timestamp-too-new" });
  });

  it("holds a custom toleranceSeconds in both directions", async () => {
    const webhooks = signing({ toleranceSeconds: 10 });
    expect((await webhooks.verify(await signedRequest("{}", { at: NOW - 10_000 }))).ok).toBe(true);
    expect((await webhooks.verify(await signedRequest("{}", { at: NOW + 10_000 }))).ok).toBe(true);
    expect(await webhooks.verify(await signedRequest("{}", { at: NOW - 11_000 }))).toEqual({ ok: false, error: "timestamp-too-old" });
    expect(await webhooks.verify(await signedRequest("{}", { at: NOW + 11_000 }))).toEqual({ ok: false, error: "timestamp-too-new" });
  });

  it("refuses a stale timestamp without reading a streamed body", async () => {
    const signed = await signing({ now: () => NOW - 301_000 }).sign({ id: "msg_1", body: "{}" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(utf8Encode("{}"));
        controller.close();
      },
    });
    const request = new Request(ENDPOINT, { method: "POST", body: stream, headers: signed });
    expect(await signing().verify(request)).toEqual({ ok: false, error: "timestamp-too-old" });
    expect(request.bodyUsed).toBe(false);
  });

  it("answers missing-header for each header absent or empty", async () => {
    for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const absent = await signedRequest("{}");
      absent.headers.delete(name);
      const empty = await signedRequest("{}", { headers: { [name]: "" } });
      expect(await signing().verify(absent)).toEqual({ ok: false, error: "missing-header" });
      expect(await signing().verify(empty)).toEqual({ ok: false, error: "missing-header" });
    }
  });

  it("answers invalid-timestamp for a timestamp that is not a plain decimal integer", async () => {
    for (const stamp of ["abc", "1.5", "-1", "1e9"]) {
      const request = await signedRequest("{}", { headers: { "webhook-timestamp": stamp } });
      expect(await signing().verify(request)).toEqual({ ok: false, error: "invalid-timestamp" });
    }
  });

  it("answers invalid-signature when no entry is a well-formed v1 signature", async () => {
    const other = await signing().sign({ id: "msg_1", body: "{}" });
    const v2 = `v2,${other["webhook-signature"].slice(3)}`;
    const short = `v1,${base64Encode(randomBytes(16))}`;
    for (const header of ["v1", "v1,!!!", v2, short]) {
      const request = await signedRequest("{}", { headers: { "webhook-signature": header } });
      expect(await signing().verify(request)).toEqual({ ok: false, error: "invalid-signature" });
    }
  });

  it("verifies across a secret rotation", async () => {
    const signedOld = () => signedRequest("{}", { secrets: [SECRET_OLD] });
    const signedBoth = await signedRequest("{}", { secrets: [SECRET_NEXT, SECRET_OLD] });
    expect((await signing({ secrets: [SECRET_NEXT, SECRET_OLD] }).verify(await signedOld())).ok).toBe(true);
    expect((await signing({ secrets: [SECRET_NEXT] }).verify(signedBoth)).ok).toBe(true);
    expect(await signing({ secrets: [SECRET_NEXT] }).verify(await signedOld())).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("refuses a declared Content-Length over the cap without reading the body", async () => {
    const request = await signedRequest("x".repeat(11), { headers: { "content-length": "11" } });
    expect(await signing({ maxBytes: 10 }).verify(request)).toEqual({ ok: false, error: "body-too-large" });
    expect(request.bodyUsed).toBe(false);
  });

  it("meters a chunked body that declares no length", async () => {
    const signed = await signing().sign({ id: "msg_1", body: "x".repeat(12) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(utf8Encode("x".repeat(6)));
        controller.enqueue(utf8Encode("x".repeat(6)));
        controller.close();
      },
    });
    const request = new Request(ENDPOINT, { method: "POST", body: stream, headers: signed });
    expect(request.headers.get("content-length")).toBeNull();
    expect(await signing({ maxBytes: 10 }).verify(request)).toEqual({ ok: false, error: "body-too-large" });
  });

  it("meters a body whose Content-Length understates it", async () => {
    const request = await signedRequest("x".repeat(20), { headers: { "content-length": "5" } });
    expect(await signing({ maxBytes: 10 }).verify(request)).toEqual({ ok: false, error: "body-too-large" });
  });

  it("accepts a body of exactly maxBytes", async () => {
    const request = await signedRequest("x".repeat(10));
    expect((await signing({ maxBytes: 10 }).verify(request)).ok).toBe(true);
  });

  it("caps the body at 1 MiB by default", async () => {
    const atCap = await signedRequest("x".repeat(1_048_576));
    const overCap = await signedRequest("x".repeat(1_048_577));
    expect((await signing().verify(atCap)).ok).toBe(true);
    expect(await signing().verify(overCap)).toEqual({ ok: false, error: "body-too-large" });
  });

  it("verifies a bodiless request against a signature over the empty body", async () => {
    const signed = await signing().sign({ id: "msg_1", body: "" });
    const result = await signing().verify(new Request(ENDPOINT, { method: "POST", headers: signed }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.body.byteLength).toBe(0);
  });

  it("consumes the request body on success", async () => {
    const request = await signedRequest("{}");
    expect((await signing().verify(request)).ok).toBe(true);
    expect(request.bodyUsed).toBe(true);
  });

  it("compares through timingSafeEqualBytes on both a match and a mismatch", async () => {
    timingSafeEqualSpy.mockClear();
    expect((await signing().verify(await signedRequest("{}"))).ok).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalled();
    timingSafeEqualSpy.mockClear();
    expect((await signing({ secrets: [SECRET_NEXT] }).verify(await signedRequest("{}"))).ok).toBe(false);
    expect(timingSafeEqualSpy).toHaveBeenCalled();
  });

  it("throws synchronously on every misconfiguration, naming createWebhookSigning", () => {
    const short = `whsec_${base64Encode(randomBytes(31))}`;
    const cases: WebhookSigningOptions[] = [
      { secrets: [] },
      { secrets: ["whsec_not*base64"] },
      { secrets: [short] },
      { secrets: ["MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwMfKQ9r8GKYqr"] },
      { secrets: [`whsec_${base64Encode(new Uint8Array(32).fill(0x2a))}`] },
      { secrets: [SECRET_OLD, short] },
      { secrets: [SECRET_OLD], toleranceSeconds: 0 },
      { secrets: [SECRET_OLD], toleranceSeconds: 1.5 },
      { secrets: [SECRET_OLD], maxBytes: 0 },
      { secrets: [SECRET_OLD], maxBytes: 1.5 },
    ];
    for (const options of cases) {
      const message = thrownMessage(() => createWebhookSigning(options));
      expect(message.startsWith("createWebhookSigning: ")).toBe(true);
      expect(message).not.toContain(short.slice(6));
    }
  });
});

describe("createWebhookSigning key import", () => {
  it("imports each secret once across repeated sign and rotation verify calls", async () => {
    const signedOld = await signedRequest("{}", { secrets: [SECRET_OLD] });
    const signedNext = await signedRequest("{}", { secrets: [SECRET_NEXT] });
    const signedByStranger = await signedRequest("{}", { secrets: [`whsec_${base64Encode(randomBytes(32))}`] });
    const imported = recordImports();
    const webhooks = signing({ secrets: [SECRET_NEXT, SECRET_OLD] });
    for (const id of ["msg_1", "msg_2", "msg_3"]) await webhooks.sign({ id, body: "{}" });
    expect((await webhooks.verify(signedOld)).ok).toBe(true);
    expect((await webhooks.verify(signedNext)).ok).toBe(true);
    expect(await webhooks.verify(signedByStranger)).toEqual({ ok: false, error: "signature-mismatch" });
    expect(imported).toEqual([rawSecret(SECRET_NEXT), rawSecret(SECRET_OLD)]);
  });

  it("shares one pending import per secret among calls that start before any import settles", async () => {
    const requests = await Promise.all([signedRequest("{}", { secrets: [SECRET_OLD] }), signedRequest("{}", { secrets: [SECRET_NEXT] })]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const imported = recordImports([], gate);
    const webhooks = signing({ secrets: [SECRET_NEXT, SECRET_OLD] });
    const pending = Promise.all([
      webhooks.sign({ id: "msg_1", body: "{}" }),
      webhooks.sign({ id: "msg_2", body: "{}" }),
      webhooks.sign({ id: "msg_3", body: "{}" }),
      ...requests.map((request) => webhooks.verify(request)),
    ]);
    expect(imported).toHaveLength(2);
    release();
    const [first, second, third, ...verified] = await pending;
    expect([first["webhook-id"], second["webhook-id"], third["webhook-id"]]).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(verified.map((result) => result.ok)).toEqual([true, true]);
    expect(imported).toEqual([rawSecret(SECRET_NEXT), rawSecret(SECRET_OLD)]);
  });

  it("rejects sign when its import rejects, then re-imports on the next call", async () => {
    const expected = await signing().sign({ id: "msg_1", body: "{}" });
    const imported = recordImports([rejectImport]);
    const webhooks = signing();
    await expect(webhooks.sign({ id: "msg_1", body: "{}" })).rejects.toThrow("import unavailable");
    expect(await webhooks.sign({ id: "msg_1", body: "{}" })).toEqual(expected);
    expect(await webhooks.sign({ id: "msg_1", body: "{}" })).toEqual(expected);
    expect(imported).toEqual([rawSecret(SECRET_OLD), rawSecret(SECRET_OLD)]);
  });

  it("rejects verify when its import rejects, then re-imports on the next call", async () => {
    const [failing, recovering, again] = await Promise.all([signedRequest("{}"), signedRequest("{}"), signedRequest("{}")]);
    const imported = recordImports([rejectImport]);
    const webhooks = signing();
    await expect(webhooks.verify(failing)).rejects.toThrow("import unavailable");
    expect((await webhooks.verify(recovering)).ok).toBe(true);
    expect((await webhooks.verify(again)).ok).toBe(true);
    expect(imported).toEqual([rawSecret(SECRET_OLD), rawSecret(SECRET_OLD)]);
  });

  it("re-imports only the secret whose import rejected", async () => {
    const imported = recordImports([undefined, rejectImport]);
    const webhooks = signing({ secrets: [SECRET_NEXT, SECRET_OLD] });
    await expect(webhooks.sign({ id: "msg_1", body: "{}" })).rejects.toThrow("import unavailable");
    await webhooks.sign({ id: "msg_1", body: "{}" });
    await webhooks.sign({ id: "msg_1", body: "{}" });
    expect(imported).toEqual([rawSecret(SECRET_NEXT), rawSecret(SECRET_OLD), rawSecret(SECRET_OLD)]);
  });

  it("imports nothing for a webhook refused before the signature comparison", async () => {
    const missingHeader = await signedRequest("{}");
    missingHeader.headers.delete("webhook-signature");
    const refused = [
      { request: missingHeader, error: "missing-header" },
      { request: await signedRequest("{}", { headers: { "webhook-timestamp": "abc" } }), error: "invalid-timestamp" },
      { request: await signedRequest("{}", { at: NOW - 301_000 }), error: "timestamp-too-old" },
      { request: await signedRequest("{}", { at: NOW + 301_000 }), error: "timestamp-too-new" },
      { request: await signedRequest("{}", { headers: { "webhook-signature": "v1,!!!" } }), error: "invalid-signature" },
      { request: await signedRequest("x".repeat(11)), error: "body-too-large" },
    ];
    const accepted = await signedRequest("{}");
    const imported = recordImports();
    const webhooks = signing({ maxBytes: 10 });
    for (const { request, error } of refused) {
      expect(await webhooks.verify(request)).toEqual({ ok: false, error });
    }
    expect(imported).toEqual([]);
    expect((await webhooks.verify(accepted)).ok).toBe(true);
    expect(imported).toEqual([rawSecret(SECRET_OLD)]);
  });
});
