import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkIccProfile, renderIccModule } from "./icc-profile";

// A profile is built rather than read from the tree: the header fields are what the check judges,
// and a fixture that can be made wrong on purpose is the only way to show it rejects one.
function profileOf(over: Partial<{ length: number; device: string; signature: string }> = {}): Uint8Array {
  const bytes = new Uint8Array(128);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, over.length ?? bytes.length);
  bytes.set(
    [...(over.device ?? "mntr")].map((character) => character.charCodeAt(0)),
    12,
  );
  bytes.set(
    [...(over.signature ?? "acsp")].map((character) => character.charCodeAt(0)),
    36,
  );
  return bytes;
}

function checked(profile: Uint8Array, module?: string): ReturnType<typeof checkIccProfile> {
  const root = mkdtempSync(resolve(tmpdir(), "forge-icc-"));
  writeFileSync(resolve(root, "profile.icc"), profile);
  writeFileSync(resolve(root, "icc.ts"), module ?? renderIccModule("profile.icc", profile));
  return checkIccProfile({ root, profile: "profile.icc", module: "icc.ts" });
}

describe("the committed ICC module is held against the profile beside it", () => {
  test("passes where the module carries the profile's own bytes", () => {
    expect(checked(profileOf()).findings).toEqual([]);
  });

  test("fails where the profile was replaced without regenerating the module", () => {
    const stale = renderIccModule("profile.icc", profileOf());
    expect(checked(profileOf({ device: "prtr" }), stale).findings).not.toEqual([]);
  });

  test("fails where the module is missing altogether", () => {
    const root = mkdtempSync(resolve(tmpdir(), "forge-icc-"));
    writeFileSync(resolve(root, "profile.icc"), profileOf());
    expect(checkIccProfile({ root, profile: "profile.icc", module: "absent.ts" }).findings).not.toEqual([]);
  });
});

// A valid encoding of an invalid profile is a file declaring an intent no checker accepts, so the
// profile itself is judged and not only the round trip.
describe("the profile itself is one PDF/A can name as an output intent", () => {
  test("rejects a device class PDF/A does not admit", () => {
    expect(
      checked(profileOf({ device: "spac" }))
        .findings.at(0)
        ?.detail?.join(" "),
    ).toContain("device class");
  });

  test("admits the printer class beside the display one", () => {
    expect(checked(profileOf({ device: "prtr" })).findings).toEqual([]);
  });

  test("rejects a header whose declared length is not the file's", () => {
    expect(
      checked(profileOf({ length: 9999 }))
        .findings.at(0)
        ?.detail?.join(" "),
    ).toContain("declares 9999 bytes");
  });

  test("rejects a file carrying no profile signature at all", () => {
    expect(
      checked(profileOf({ signature: "junk" }))
        .findings.at(0)
        ?.detail?.join(" "),
    ).toContain("rather than acsp");
  });
});
