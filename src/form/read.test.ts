import { describe, expect, it } from "bun:test";
import { readFields, readTextField } from "./read";

describe("readTextField", () => {
  it("reads a string value", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    expect(readTextField(fd, "name")).toBe("Alice");
  });

  it("trims leading and trailing whitespace", () => {
    const fd = new FormData();
    fd.append("name", "  Bob  ");
    expect(readTextField(fd, "name")).toBe("Bob");
  });

  it("normalises CRLF to LF", () => {
    const fd = new FormData();
    fd.append("message", "line1\r\nline2");
    expect(readTextField(fd, "message")).toBe("line1\nline2");
  });

  it("returns empty string for a missing field", () => {
    const fd = new FormData();
    expect(readTextField(fd, "missing")).toBe("");
  });

  it("returns empty string for a File value", () => {
    const fd = new FormData();
    fd.append("file", new Blob(["data"]), "test.txt");
    expect(readTextField(fd, "file")).toBe("");
  });

  it("returns empty string for an empty field", () => {
    const fd = new FormData();
    fd.append("email", "");
    expect(readTextField(fd, "email")).toBe("");
  });
});

describe("readFields", () => {
  it("reads multiple fields at once", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("email", "alice@example.com");
    fd.append("phone", " +27 11 000 0000 ");

    const result = readFields(fd, ["name", "email", "phone"]);

    expect(result).toEqual({ name: "Alice", email: "alice@example.com", phone: "+27 11 000 0000" });
  });

  it("returns empty strings for missing fields", () => {
    const fd = new FormData();
    const result = readFields(fd, ["a", "b"]);
    expect(result).toEqual({ a: "", b: "" });
  });
});
