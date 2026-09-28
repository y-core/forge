import { describe, expect, it, mock } from "bun:test";

import { base64DecodeOrNull, base64Encode } from "../crypto/base64";
import { randomBytes, utf8Encode } from "../crypto/bytes";
import { importHmacKey } from "../crypto/hmac";
import * as timing from "../crypto/timing";
import { computeWebhookSignature, signWebhook, verifyWebhook } from "./webhook";

const realTimingSafeEqualBytes = timing.timingSafeEqualBytes;
const timingSafeEqualSpy = mock((a: Uint8Array, b: Uint8Array) => realTimingSafeEqualBytes(a, b));
await mock.module("../crypto/timing", () => ({ ...timing, timingSafeEqualBytes: timingSafeEqualSpy }));

const NOW = 1_700_000_000_000;
const now = () => NOW;
const SECRET_OLD = `whsec_${base64Encode(randomBytes(32))}`;
const SECRET_NEXT = `whsec_${base64Encode(randomBytes(32))}`;
const ENDPOINT = "https://receiver.example.com/webhooks";

async function signedRequest(
  body: string | Uint8Array<ArrayBuffer>,
  options: { secrets?: string[]; at?: number; id?: string; headers?: Record<string, string> } = {},
): Promise<Request> {
  const signed = await signWebhook({ id: options.id ?? "msg_1", body, secrets: options.secrets ?? [SECRET_OLD], now: () => options.at ?? NOW });
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

describe("signWebhook", () => {
  it("refuses the 24-byte reference secret synchronously, without echoing it", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    expectMessageOmitsSecret(() => signWebhook({ id: "msg_1", body: "{}", secrets: [secret] }), secret, "24 bytes");
    expectMessageOmitsSecret(() => signWebhook({ id: "msg_1", body: "{}", secrets: [secret] }), secret, "32-byte floor");
  });

  it("produces exactly the three Standard Webhooks headers", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now });
    const init: HeadersInit = signed;
    expect(Object.keys(signed).toSorted()).toEqual(["webhook-id", "webhook-signature", "webhook-timestamp"]);
    expect(signed["webhook-id"]).toBe("msg_1");
    expect(signed["webhook-timestamp"]).toBe(String(Math.floor(NOW / 1000)));
    expect(signed["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/);
    expect(new Headers(init).get("webhook-signature")).toBe(signed["webhook-signature"]);
  });

  it("emits one space-separated v1 signature per secret, in order", async () => {
    const both = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_NEXT, SECRET_OLD], now });
    const next = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_NEXT], now });
    const old = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now });
    expect(both["webhook-signature"]).toBe(`${next["webhook-signature"]} ${old["webhook-signature"]}`);
  });

  it("signs a string body and its UTF-8 bytes identically", async () => {
    const body = '{"name":"Zoë"}';
    const fromString = await signWebhook({ id: "msg_1", body, secrets: [SECRET_OLD], now });
    const fromBytes = await signWebhook({ id: "msg_1", body: utf8Encode(body), secrets: [SECRET_OLD], now });
    expect(fromBytes["webhook-signature"]).toBe(fromString["webhook-signature"]);
  });

  it("throws synchronously on every misconfiguration, never echoing a secret", () => {
    const short = `whsec_${base64Encode(randomBytes(31))}`;
    const sign = (id: string, secrets: string[]) => () => signWebhook({ id, body: "{}", secrets });
    expect(sign("msg_1", [])).toThrow("signWebhook: secrets is empty");
    expectMessageOmitsSecret(sign("msg_1", ["MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwMfKQ9r8GKYqr"]), "MfKQ9r8GKYqr", "whsec_-prefixed");
    expectMessageOmitsSecret(sign("msg_1", ["whsec_not*base64"]), "not*base64", "whsec_-prefixed");
    expectMessageOmitsSecret(sign("msg_1", [short]), short.slice(6), "31 bytes");
    expect(sign("", [SECRET_OLD])).toThrow("signWebhook: id is empty");
    expect(sign("msg.1", [SECRET_OLD])).toThrow('signWebhook: id contains "."');
  });
});

describe("verifyWebhook", () => {
  it("accepts a valid webhook and hands back the exact signed bytes", async () => {
    const body = utf8Encode('{"greeting":"héllo — 世界"}');
    const result = await verifyWebhook(await signedRequest(body), { secrets: [SECRET_OLD], now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.body).toEqual(body);
    expect(result.data.id).toBe("msg_1");
    expect(result.data.timestamp).toBe(Math.floor(NOW / 1000));
  });

  it("answers signature-mismatch for a tampered body byte", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now });
    const request = new Request(ENDPOINT, { method: "POST", body: "{ ", headers: signed });
    expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("answers signature-mismatch for a tampered id or a timestamp moved within tolerance", async () => {
    const byId = await signedRequest("{}", { headers: { "webhook-id": "msg_2" } });
    const byStamp = await signedRequest("{}", { headers: { "webhook-timestamp": String(Math.floor(NOW / 1000) - 1) } });
    expect(await verifyWebhook(byId, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "signature-mismatch" });
    expect(await verifyWebhook(byStamp, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("answers signature-mismatch under the wrong secret", async () => {
    const request = await signedRequest("{}");
    expect(await verifyWebhook(request, { secrets: [SECRET_NEXT], now })).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("answers signature-mismatch when the last significant base64 character changes", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now });
    const tampered = flipLastBase64Char(signed["webhook-signature"]);
    const request = new Request(ENDPOINT, { method: "POST", body: "{}", headers: { ...signed, "webhook-signature": tampered } });
    expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("ignores an entry of another version ahead of a valid v1", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now });
    const header = `v1a,xxx ${signed["webhook-signature"]}`;
    const request = new Request(ENDPOINT, { method: "POST", body: "{}", headers: { ...signed, "webhook-signature": header } });
    expect((await verifyWebhook(request, { secrets: [SECRET_OLD], now })).ok).toBe(true);
  });

  it("accepts a timestamp exactly at either edge of the tolerance", async () => {
    const early = await signedRequest("{}", { at: NOW - 300_000 });
    const late = await signedRequest("{}", { at: NOW + 300_000 });
    expect((await verifyWebhook(early, { secrets: [SECRET_OLD], now })).ok).toBe(true);
    expect((await verifyWebhook(late, { secrets: [SECRET_OLD], now })).ok).toBe(true);
  });

  it("refuses a timestamp one second past either edge", async () => {
    const old = await signedRequest("{}", { at: NOW - 301_000 });
    const future = await signedRequest("{}", { at: NOW + 301_000 });
    expect(await verifyWebhook(old, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "timestamp-too-old" });
    expect(await verifyWebhook(future, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "timestamp-too-new" });
  });

  it("holds a custom toleranceSeconds in both directions", async () => {
    const options = { secrets: [SECRET_OLD], now, toleranceSeconds: 10 };
    expect((await verifyWebhook(await signedRequest("{}", { at: NOW - 10_000 }), options)).ok).toBe(true);
    expect((await verifyWebhook(await signedRequest("{}", { at: NOW + 10_000 }), options)).ok).toBe(true);
    expect(await verifyWebhook(await signedRequest("{}", { at: NOW - 11_000 }), options)).toEqual({ ok: false, error: "timestamp-too-old" });
    expect(await verifyWebhook(await signedRequest("{}", { at: NOW + 11_000 }), options)).toEqual({ ok: false, error: "timestamp-too-new" });
  });

  it("refuses a stale timestamp without reading a streamed body", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now: () => NOW - 301_000 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(utf8Encode("{}"));
        controller.close();
      },
    });
    const request = new Request(ENDPOINT, { method: "POST", body: stream, headers: signed });
    expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "timestamp-too-old" });
    expect(request.bodyUsed).toBe(false);
  });

  it("answers missing-header for each header absent or empty", async () => {
    for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const absent = await signedRequest("{}");
      absent.headers.delete(name);
      const empty = await signedRequest("{}", { headers: { [name]: "" } });
      expect(await verifyWebhook(absent, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "missing-header" });
      expect(await verifyWebhook(empty, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "missing-header" });
    }
  });

  it("answers invalid-timestamp for a timestamp that is not a plain decimal integer", async () => {
    for (const stamp of ["abc", "1.5", "-1", "1e9"]) {
      const request = await signedRequest("{}", { headers: { "webhook-timestamp": stamp } });
      expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "invalid-timestamp" });
    }
  });

  it("answers invalid-signature when no entry is a well-formed v1 signature", async () => {
    const other = await signWebhook({ id: "msg_1", body: "{}", secrets: [SECRET_OLD], now });
    const v2 = `v2,${other["webhook-signature"].slice(3)}`;
    const short = `v1,${base64Encode(randomBytes(16))}`;
    for (const header of ["v1", "v1,!!!", v2, short]) {
      const request = await signedRequest("{}", { headers: { "webhook-signature": header } });
      expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "invalid-signature" });
    }
  });

  it("verifies across a secret rotation", async () => {
    const signedOld = () => signedRequest("{}", { secrets: [SECRET_OLD] });
    const signedBoth = await signedRequest("{}", { secrets: [SECRET_NEXT, SECRET_OLD] });
    expect((await verifyWebhook(await signedOld(), { secrets: [SECRET_NEXT, SECRET_OLD], now })).ok).toBe(true);
    expect((await verifyWebhook(signedBoth, { secrets: [SECRET_NEXT], now })).ok).toBe(true);
    expect(await verifyWebhook(await signedOld(), { secrets: [SECRET_NEXT], now })).toEqual({ ok: false, error: "signature-mismatch" });
  });

  it("refuses a declared Content-Length over the cap without reading the body", async () => {
    const request = await signedRequest("x".repeat(11), { headers: { "content-length": "11" } });
    expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now, maxBytes: 10 })).toEqual({ ok: false, error: "body-too-large" });
    expect(request.bodyUsed).toBe(false);
  });

  it("meters a chunked body that declares no length", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "x".repeat(12), secrets: [SECRET_OLD], now });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(utf8Encode("x".repeat(6)));
        controller.enqueue(utf8Encode("x".repeat(6)));
        controller.close();
      },
    });
    const request = new Request(ENDPOINT, { method: "POST", body: stream, headers: signed });
    expect(request.headers.get("content-length")).toBeNull();
    expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now, maxBytes: 10 })).toEqual({ ok: false, error: "body-too-large" });
  });

  it("meters a body whose Content-Length understates it", async () => {
    const request = await signedRequest("x".repeat(20), { headers: { "content-length": "5" } });
    expect(await verifyWebhook(request, { secrets: [SECRET_OLD], now, maxBytes: 10 })).toEqual({ ok: false, error: "body-too-large" });
  });

  it("accepts a body of exactly maxBytes", async () => {
    const request = await signedRequest("x".repeat(10));
    expect((await verifyWebhook(request, { secrets: [SECRET_OLD], now, maxBytes: 10 })).ok).toBe(true);
  });

  it("caps the body at 1 MiB by default", async () => {
    const atCap = await signedRequest("x".repeat(1_048_576));
    const overCap = await signedRequest("x".repeat(1_048_577));
    expect((await verifyWebhook(atCap, { secrets: [SECRET_OLD], now })).ok).toBe(true);
    expect(await verifyWebhook(overCap, { secrets: [SECRET_OLD], now })).toEqual({ ok: false, error: "body-too-large" });
  });

  it("verifies a bodiless request against a signature over the empty body", async () => {
    const signed = await signWebhook({ id: "msg_1", body: "", secrets: [SECRET_OLD], now });
    const result = await verifyWebhook(new Request(ENDPOINT, { method: "POST", headers: signed }), { secrets: [SECRET_OLD], now });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.body.byteLength).toBe(0);
  });

  it("consumes the request body on success", async () => {
    const request = await signedRequest("{}");
    expect((await verifyWebhook(request, { secrets: [SECRET_OLD], now })).ok).toBe(true);
    expect(request.bodyUsed).toBe(true);
  });

  it("compares through timingSafeEqualBytes on both a match and a mismatch", async () => {
    timingSafeEqualSpy.mockClear();
    expect((await verifyWebhook(await signedRequest("{}"), { secrets: [SECRET_OLD], now })).ok).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalled();
    timingSafeEqualSpy.mockClear();
    expect((await verifyWebhook(await signedRequest("{}"), { secrets: [SECRET_NEXT], now })).ok).toBe(false);
    expect(timingSafeEqualSpy).toHaveBeenCalled();
  });

  it("throws synchronously on every misconfiguration, naming verifyWebhook", () => {
    const request = new Request(ENDPOINT, { method: "POST" });
    const short = `whsec_${base64Encode(randomBytes(31))}`;
    const cases: Parameters<typeof verifyWebhook>[1][] = [
      { secrets: [] },
      { secrets: ["whsec_not*base64"] },
      { secrets: [short] },
      { secrets: [SECRET_OLD], toleranceSeconds: 0 },
      { secrets: [SECRET_OLD], toleranceSeconds: 1.5 },
      { secrets: [SECRET_OLD], maxBytes: 0 },
      { secrets: [SECRET_OLD], maxBytes: 1.5 },
    ];
    for (const options of cases) {
      const message = thrownMessage(() => verifyWebhook(request, options));
      expect(message.startsWith("verifyWebhook: ")).toBe(true);
      expect(message).not.toContain(short.slice(6));
    }
  });
});
