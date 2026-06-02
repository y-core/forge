import { describe, expect, it } from "bun:test";
import { createSignedCookie } from "./signed";

const SECRET_32 = "a".repeat(32);
const SECRET_64 = "b".repeat(64);

describe("createSignedCookie — secret validation", () => {
  it("does not throw for a single secret of exactly 32 characters", () => {
    expect(() => createSignedCookie("session", { secrets: [SECRET_32] })).not.toThrow();
  });

  it("does not throw for a single secret longer than 32 characters", () => {
    expect(() => createSignedCookie("session", { secrets: [SECRET_64] })).not.toThrow();
  });

  it("does not throw when all secrets in a multi-secret array are valid", () => {
    expect(() =>
      createSignedCookie("session", { secrets: [SECRET_32, SECRET_64] }),
    ).not.toThrow();
  });

  it("throws when the only secret is shorter than 32 characters", () => {
    expect(() =>
      createSignedCookie("session", { secrets: ["short"] }),
    ).toThrow("at least 32 characters");
  });

  it("throws when one secret in a multi-secret array is too short (even if first is valid)", () => {
    expect(() =>
      createSignedCookie("session", { secrets: [SECRET_32, "short"] }),
    ).toThrow("at least 32 characters");
  });

  it("throws with a message that includes the offending length", () => {
    let message = "";
    try {
      createSignedCookie("session", { secrets: ["abc"] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("3");
    expect(message).toContain("at least 32 characters");
  });
});

describe("createSignedCookie — returned cookie", () => {
  it("returns a cookie object with the provided name", () => {
    const cookie = createSignedCookie("auth-session", { secrets: [SECRET_32] });
    expect(cookie.name).toBe("auth-session");
  });

  it("returns a cookie with the provided name when multiple secrets are supplied", () => {
    const cookie = createSignedCookie("my-cookie", { secrets: [SECRET_32, SECRET_64] });
    expect(cookie.name).toBe("my-cookie");
  });

  it("defaults sameSite to Lax when not specified", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET_32] });
    const serialized = await cookie.serialize("value");
    expect(serialized).toContain("SameSite=Lax");
  });

  it("respects a Strict sameSite override", async () => {
    const cookie = createSignedCookie("session", {
      secrets: [SECRET_32],
      sameSite: "Strict",
    });
    const serialized = await cookie.serialize("value");
    expect(serialized).toContain("SameSite=Strict");
  });

  it("always sets HttpOnly on the serialized cookie", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET_32] });
    const serialized = await cookie.serialize("value");
    expect(serialized).toContain("HttpOnly");
  });

  it("always sets Secure on the serialized cookie", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET_32] });
    const serialized = await cookie.serialize("value");
    expect(serialized).toContain("Secure");
  });
});
