import { describe, expect, it } from "bun:test";

import { AuthStoreError } from "./errors";

describe("AuthStoreError", () => {
  it("carries the code and operation, and names both in the message", () => {
    const error = new AuthStoreError("unavailable", "users.findByEmailKey");
    expect(error.code).toBe("unavailable");
    expect(error.operation).toBe("users.findByEmailKey");
    expect(error.message).toBe('auth store unavailable during "users.findByEmailKey"');
  });

  it("is an Error with its own name, so a catch-all still reports it usefully", () => {
    const error = new AuthStoreError("conflict", "users.insert");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthStoreError);
    expect(error.name).toBe("AuthStoreError");
  });

  it("records the constraint a conflict violated", () => {
    const error = new AuthStoreError("conflict", "users.insert", { constraint: "auth_users.email_key" });
    expect(error.constraint).toBe("auth_users.email_key");
  });

  it("leaves the constraint undefined when none was named", () => {
    expect(new AuthStoreError("unavailable", "users.insert").constraint).toBeUndefined();
  });

  it("keeps the underlying platform error as its cause", () => {
    const cause = new Error("D1_ERROR: UNIQUE constraint failed");
    expect(new AuthStoreError("conflict", "users.insert", { cause }).cause).toBe(cause);
  });

  it("sets no cause when none was given, rather than an undefined one", () => {
    expect("cause" in new AuthStoreError("unavailable", "users.insert")).toBe(false);
  });
});
