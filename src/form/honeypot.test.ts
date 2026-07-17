import { describe, expect, it } from "bun:test";
import { isHoneypotFilled } from "./honeypot";

describe("isHoneypotFilled", () => {
  it("returns true when the default __surname field has a value", () => {
    const fd = new FormData();
    fd.append("__surname", "Bot");
    expect(isHoneypotFilled(fd)).toBe(true);
  });

  it("returns false when the default __surname field is empty", () => {
    const fd = new FormData();
    fd.append("__surname", "");
    expect(isHoneypotFilled(fd)).toBe(false);
  });

  it("returns false when the default __surname field is absent", () => {
    const fd = new FormData();
    expect(isHoneypotFilled(fd)).toBe(false);
  });

  it("checks a custom field name", () => {
    const fd = new FormData();
    fd.append("website", "http://spam.com");
    expect(isHoneypotFilled(fd, "website")).toBe(true);
  });

  it("returns false for a custom field that is empty", () => {
    const fd = new FormData();
    fd.append("website", "");
    expect(isHoneypotFilled(fd, "website")).toBe(false);
  });

  it("returns true when the field contains a non-empty File", () => {
    const fd = new FormData();
    fd.append("__surname", new File(["content"], "bot.txt"));
    expect(isHoneypotFilled(fd)).toBe(true);
  });

  it("returns false when the field contains an empty File (zero bytes)", () => {
    const fd = new FormData();
    fd.append("__surname", new File([], "empty.txt"));
    expect(isHoneypotFilled(fd)).toBe(false);
  });
});
