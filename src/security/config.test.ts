import { describe, expect, it } from "bun:test";

import { validateEnv } from "../context/env-validation";
import { base64Encode } from "../crypto/primitives/base64";
import { randomBytes, utf8Encode } from "../crypto/primitives/bytes";
import { v } from "../validation/mod";
import { parseWebhookSecrets, WebhookSecretSchema } from "./config";
import { createWebhookSigning } from "./webhook";

const SCHEMA_MESSAGE = "must be comma-separated secrets, each whsec_ followed by base64 of at least 32 bytes";
const NEWER_SECRET = `whsec_${base64Encode(randomBytes(32))}`;
const OLDER_SECRET = `whsec_${base64Encode(randomBytes(48))}`;
const SHORT_SECRET = `whsec_${base64Encode(randomBytes(31))}`;
const STRANGER_SECRET = `whsec_${base64Encode(randomBytes(32))}`;
// 33 bytes of 0xfb 0xff 0xbf encode to "+/+/" repeated, so the base64url form is "-_-_" repeated.
const PLUS_SLASH_PAYLOAD = base64Encode(new Uint8Array(33).map((_, i) => [0xfb, 0xff, 0xbf][i % 3] ?? 0));
const NOW = 1_700_000_000_000;
const now = () => NOW;
const ENDPOINT = "https://receiver.example.com/webhooks";

async function signedBy(secrets: [string, ...string[]], body: string): Promise<Request> {
  const headers = await createWebhookSigning({ secrets, now }).sign({ id: "msg_1", body });
  return new Request(ENDPOINT, { method: "POST", headers, body });
}

describe("parseWebhookSecrets", () => {
  it("splits a comma-joined value in order", () => {
    expect(parseWebhookSecrets("whsec_a,whsec_b")).toEqual(["whsec_a", "whsec_b"]);
  });

  it("trims the whitespace around each entry", () => {
    expect(parseWebhookSecrets("  whsec_a , whsec_b\n")).toEqual(["whsec_a", "whsec_b"]);
  });

  for (const value of ["", "   "]) {
    it(`refuses the empty value ${JSON.stringify(value)}`, () => {
      expect(() => parseWebhookSecrets(value)).toThrow("parseWebhookSecrets: the webhook-secret value is empty");
    });
  }

  for (const value of ["whsec_a,,whsec_b", "whsec_a,", ",whsec_a", "whsec_a, ,whsec_b", ","]) {
    it(`refuses the empty entry in ${JSON.stringify(value)}`, () => {
      expect(() => parseWebhookSecrets(value)).toThrow("parseWebhookSecrets: the webhook-secret value has an empty entry between its commas");
    });
  }
});

describe("parseWebhookSecrets feeding createWebhookSigning", () => {
  it("verifies a webhook signed under the newer secret against the parsed rotation list", async () => {
    const webhooks = createWebhookSigning({ secrets: parseWebhookSecrets(` ${NEWER_SECRET} , ${OLDER_SECRET}\n`), now });
    expect(await webhooks.verify(await signedBy([NEWER_SECRET], '{"n":1}'))).toEqual({
      ok: true,
      data: { id: "msg_1", timestamp: NOW / 1000, body: utf8Encode('{"n":1}') },
    });
  });

  it("verifies a webhook signed under the older secret against the parsed rotation list", async () => {
    const webhooks = createWebhookSigning({ secrets: parseWebhookSecrets(`${NEWER_SECRET},${OLDER_SECRET}`), now });
    expect((await webhooks.verify(await signedBy([OLDER_SECRET], "{}"))).ok).toBe(true);
  });

  it("refuses a webhook signed under a secret the parsed list does not hold", async () => {
    const webhooks = createWebhookSigning({ secrets: parseWebhookSecrets(`${NEWER_SECRET},${OLDER_SECRET}`), now });
    expect(await webhooks.verify(await signedBy([STRANGER_SECRET], "{}"))).toEqual({ ok: false, error: "signature-mismatch" });
  });
});

describe("WebhookSecretSchema", () => {
  for (const value of [NEWER_SECRET, `${NEWER_SECRET},${OLDER_SECRET}`, `${NEWER_SECRET} , ${OLDER_SECRET}`]) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(v.safeParse(WebhookSecretSchema, value).success).toBe(true);
    });
  }

  it("answers the value trimmed", () => {
    expect(v.parse(WebhookSecretSchema, `\n${NEWER_SECRET} `)).toBe(NEWER_SECRET);
  });

  it("answers a rotation list trimmed at its ends only", () => {
    expect(v.parse(WebhookSecretSchema, `\n ${NEWER_SECRET} , ${OLDER_SECRET}\t`)).toBe(`${NEWER_SECRET} , ${OLDER_SECRET}`);
  });

  it("accepts a payload of exactly 32 bytes", () => {
    expect(v.safeParse(WebhookSecretSchema, `whsec_${base64Encode(new Uint8Array(32))}`).success).toBe(true);
  });

  it("accepts standard base64 carrying + and /", () => {
    expect(v.safeParse(WebhookSecretSchema, `whsec_${PLUS_SLASH_PAYLOAD}`).success).toBe(true);
  });

  const refused = [
    "",
    SHORT_SECRET,
    NEWER_SECRET.slice("whsec_".length),
    `whsec_${"!".repeat(44)}`,
    `${NEWER_SECRET},`,
    `${NEWER_SECRET},,${OLDER_SECRET}`,
    `${NEWER_SECRET},${SHORT_SECRET}`,
    `whsec_${base64Encode(new Uint8Array(31))}`,
    "whsec_",
    `WHSEC_${NEWER_SECRET.slice("whsec_".length)}`,
    `Whsec_${NEWER_SECRET.slice("whsec_".length)}`,
    `whsec${NEWER_SECRET.slice("whsec_".length)}`,
    `whsec_${PLUS_SLASH_PAYLOAD.replaceAll("+", "-").replaceAll("/", "_")}`,
    `,${NEWER_SECRET}`,
    `${NEWER_SECRET}, ,${OLDER_SECRET}`,
    "   ",
  ];
  for (const value of refused) {
    it(`refuses ${JSON.stringify(value)} with the webhook-secret message`, () => {
      const result = v.safeParse(WebhookSecretSchema, value);
      expect(result.issues?.[0]?.message).toBe(SCHEMA_MESSAGE);
    });
  }

  it("fails env validation naming the variable when a rotation entry is short", () => {
    const EnvSchema = v.object({ WEBHOOK_SECRETS: WebhookSecretSchema });
    expect(() => validateEnv({ WEBHOOK_SECRETS: `${NEWER_SECRET},${SHORT_SECRET}` }, EnvSchema)).toThrow(
      `Invalid environment: WEBHOOK_SECRETS: ${SCHEMA_MESSAGE}`,
    );
  });

  it("passes env validation with a rotation list, answering it ready for parseWebhookSecrets", () => {
    const EnvSchema = v.object({ WEBHOOK_SECRETS: WebhookSecretSchema });
    const env = validateEnv({ WEBHOOK_SECRETS: ` ${NEWER_SECRET},${OLDER_SECRET} ` }, EnvSchema);
    expect(parseWebhookSecrets(env.WEBHOOK_SECRETS)).toEqual([NEWER_SECRET, OLDER_SECRET]);
  });

  it("refuses a value that is not a string", () => {
    expect(v.safeParse(WebhookSecretSchema, 42).success).toBe(false);
  });
});
