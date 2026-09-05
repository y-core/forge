import { describe, expect, it } from "bun:test";

import { isHoneypotFilled } from "./honeypot";

describe("isHoneypotFilled", () => {
  it("returns true when the default __hp_c7 field has a value", () => {
    const fd = new FormData();
    fd.append("__hp_c7", "Bot");
    expect(isHoneypotFilled(fd)).toBe(true);
  });

  it("returns false when the default __hp_c7 field is empty", () => {
    const fd = new FormData();
    fd.append("__hp_c7", "");
    expect(isHoneypotFilled(fd)).toBe(false);
  });

  it("returns false when the field holds only whitespace, as an autofill pass can leave", () => {
    const fd = new FormData();
    fd.append("__hp_c7", "   ");
    expect(isHoneypotFilled(fd)).toBe(false);
  });

  it("returns false for a field holding a newline and a tab only", () => {
    const fd = new FormData();
    fd.append("__hp_c7", "\n\t");
    expect(isHoneypotFilled(fd)).toBe(false);
  });

  it("returns true when a value is padded with whitespace but has content", () => {
    const fd = new FormData();
    fd.append("__hp_c7", "  Bot  ");
    expect(isHoneypotFilled(fd)).toBe(true);
  });

  it("returns false when the default __hp_c7 field is absent", () => {
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
    fd.append("__hp_c7", new File(["content"], "bot.txt"));
    expect(isHoneypotFilled(fd)).toBe(true);
  });

  it("returns false when the field contains an empty File (zero bytes)", () => {
    const fd = new FormData();
    fd.append("__hp_c7", new File([], "empty.txt"));
    expect(isHoneypotFilled(fd)).toBe(false);
  });
});
