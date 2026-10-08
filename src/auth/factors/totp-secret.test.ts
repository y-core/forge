import { beforeAll, describe, expect, it } from "bun:test";

import { importKeyRing } from "../../crypto/keyring/ring";
import { openAtRest } from "../../crypto/keyring/seal";
import type { KeyRing } from "../../crypto/keyring/types";
import { bytesToHex, hexToBytes, utf8Encode } from "../../crypto/primitives/mod";
import { uuidv7 } from "../../storage/db/uuid";
import { importAuthKeyRing } from "../keys/ring";
import { openTotpSecret, sealTotpSecret } from "./totp-secret";

const SECRET = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) as Uint8Array<ArrayBuffer>;
const USER_ID = uuidv7();

const ROOT_A = "e6064ea1614f137496a5d1ccd3408255da4cc39f26900b93f9dc63e4bd8543e8";
const ROOT_B = "dfa8da70879b5fb481bb6db0032ab0fa7bda29421d4a3714fae42a018b54210d";

let ringA: KeyRing;
let ringB: KeyRing;
let rotated: KeyRing;

beforeAll(async () => {
  ringA = await importAuthKeyRing([ROOT_A]);
  ringB = await importAuthKeyRing([ROOT_B]);
  rotated = await importAuthKeyRing([ROOT_B, ROOT_A]);
});

describe("sealTotpSecret", () => {
  it("frames the secret as kid(6) ‖ nonce(12) ‖ ciphertext‖tag", async () => {
    const sealed = await sealTotpSecret(ringA, USER_ID, SECRET);
    expect(sealed.byteLength).toBe(6 + 12 + SECRET.byteLength + 16);
  });

  it("leaves no plaintext in the sealed bytes, and no two seals alike", async () => {
    const first = await sealTotpSecret(ringA, USER_ID, SECRET);
    const second = await sealTotpSecret(ringA, USER_ID, SECRET);
    expect(bytesToHex(first)).not.toContain(bytesToHex(SECRET));
    expect(bytesToHex(second)).not.toContain(bytesToHex(SECRET));
    expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  });

  it("refuses to seal under a ring whose active key it does not hold", async () => {
    const broken: KeyRing = { activeKeyId: "AAAAAAAA", keys: {} };
    await expect(sealTotpSecret(broken, USER_ID, SECRET)).rejects.toThrow('the key ring has no key for its active key id "AAAAAAAA"');
  });
});

describe("openTotpSecret", () => {
  it("returns the secret it sealed, under a key the ring still calls active", async () => {
    const opened = await openTotpSecret(ringA, USER_ID, await sealTotpSecret(ringA, USER_ID, SECRET));
    expect(opened.ok && bytesToHex(opened.data.secret)).toBe(bytesToHex(SECRET));
    expect(opened.ok && opened.data.stale).toBe(false);
  });

  // What makes the re-wrap conditional: the caller re-seals on this flag rather than on every open.
  it("opens a secret sealed under a retired key and reports it stale, because the frame names the key id", async () => {
    const sealed = await sealTotpSecret(ringA, USER_ID, SECRET);
    const opened = await openTotpSecret(rotated, USER_ID, sealed);
    expect(opened.ok && bytesToHex(opened.data.secret)).toBe(bytesToHex(SECRET));
    expect(opened.ok && opened.data.stale).toBe(true);
  });

  it("calls a secret sealed under the ring's own active key fresh, whatever else the ring holds", async () => {
    const opened = await openTotpSecret(rotated, USER_ID, await sealTotpSecret(rotated, USER_ID, SECRET));
    expect(opened.ok && opened.data.stale).toBe(false);
  });

  // `no-key` and `unopenable` are different people's problems, and the caller un-enrols on one and
  // not the other — so a key merely off the ring must never be reported as a frame that will not open.
  it("tells a key the ring does not hold from a frame that did not stand up", async () => {
    const sealed = await sealTotpSecret(ringA, USER_ID, SECRET);
    const tampered = sealed.slice();
    tampered[tampered.byteLength - 1] = (tampered[tampered.byteLength - 1] ?? 0) ^ 0xff;
    // The owner is associated data, so moving a row between users in the database is not enough to
    // move a working factor with it — and that is the frame failing, not the key being absent.
    const cases = {
      "key off the ring": openTotpSecret(ringB, USER_ID, sealed),
      "sealed for another user": openTotpSecret(ringA, uuidv7(), sealed),
      "a flipped byte": openTotpSecret(ringA, USER_ID, tampered),
      "too short to hold a frame": openTotpSecret(ringA, USER_ID, sealed.slice(0, 18)),
    };
    const refused = Object.fromEntries(
      await Promise.all(
        Object.entries(cases).map(async ([what, run]) => {
          const outcome = await run;
          return [what, outcome.ok ? "opened" : outcome.error];
        }),
      ),
    );
    expect(refused).toEqual({
      "key off the ring": "no-key",
      "sealed for another user": "unopenable",
      "a flipped byte": "unopenable",
      "too short to hold a frame": "unopenable",
    });
  });
});

describe("a TOTP frame sealed before the keyring namespace existed", () => {
  const FIXTURE_USER_ID = "0190f5c2-7c1e-7000-8000-000000000001";
  const FIXTURE_KID = "OeXXoIsd";
  const FIXTURE_FRAME = "39e5d7a08b1d62a88452a8b23d3cadc02eb96d2166d06fdff6402530122c3383132d8211af0ce6a2e483bae6e81c55c8fb1cc0bb1f00";

  it("still derives the same key id from the same root secret", () => {
    expect(ringA.activeKeyId).toBe(FIXTURE_KID);
  });

  it("still opens, byte for byte", async () => {
    expect(await openTotpSecret(ringA, FIXTURE_USER_ID, hexToBytes(FIXTURE_FRAME))).toEqual({ ok: true, data: { secret: SECRET, stale: false } });
  });

  it("does not open under the keyring's own domain, whether the key id is derived there or copied across", async () => {
    const binding = { purpose: "totpWrap", context: utf8Encode(`totp-app ${FIXTURE_USER_ID}`) };
    const frame = hexToBytes(FIXTURE_FRAME);
    expect(await openAtRest(await importKeyRing([ROOT_A]), binding, frame)).toEqual({ ok: false, error: "no-key" });
    const copied = { activeKeyId: FIXTURE_KID, keys: { [FIXTURE_KID]: hexToBytes(ROOT_A) } };
    expect(await openAtRest(copied, binding, frame)).toEqual({ ok: false, error: "unopenable" });
  });
});
