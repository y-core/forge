import { describe, expect, test } from "bun:test";

import { srgbProfile } from "./icc";

// The profile is opaque bytes to the writer, so what is asserted is what PDF/A reads out of its
// header — a profile failing any of these is one no checker accepts as an output intent.
describe("the sRGB profile a PDF/A render embeds", () => {
  const profile = srgbProfile();
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const text = (from: number, to: number): string => String.fromCharCode(...profile.subarray(from, to));

  test("declares its own length, so a truncated copy is caught rather than embedded", () => {
    expect(view.getUint32(0)).toBe(profile.length);
  });

  test("carries the profile signature every ICC reader looks for", () => {
    expect(text(36, 40)).toBe("acsp");
  });

  test("is a display profile, which is one of the two classes PDF/A admits", () => {
    expect(text(12, 16)).toBe("mntr");
  });

  test("maps RGB through the connection space an /N of 3 declares", () => {
    expect(text(16, 20)).toBe("RGB ");
    expect(text(20, 24)).toBe("XYZ ");
  });

  test("is ICC version 2, the one costed against the consumer's bundle", () => {
    expect(profile[8]).toBe(2);
    expect(profile.length).toBeLessThan(8000);
  });

  test("decodes once and hands back the same bytes, so a Worker pays for it once", () => {
    expect(srgbProfile()).toBe(profile);
  });
});
