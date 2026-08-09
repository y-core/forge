import { describe, expect, it } from "bun:test";
import { formToObject } from "./to-object";
import type { ReadonlyFormData } from "./types";

/**
 * A `ReadonlyFormData` over a fixed entry list, typed to the interface so a change to it breaks this
 * file at compile time.
 *
 * It exists for one property a real `FormData` cannot give: Bun's `FormData` re-wraps a `File` on
 * every read, so `fd.get("doc") !== fd.get("doc")` and identity preservation is unobservable through
 * it. This fake yields the very instance it was seeded with, which makes "the `File` is passed
 * through unchanged" an assertion rather than a claim.
 */
function fakeFormData(entries: readonly [string, FormDataEntryValue][]): ReadonlyFormData {
  const matching = (name: string): FormDataEntryValue[] => entries.filter(([key]) => key === name).map(([, value]) => value);
  const fake: ReadonlyFormData = {
    get: (name) => matching(name)[0] ?? null,
    getAll: (name) => matching(name),
    has: (name) => matching(name).length > 0,
    entries: () => entries.values(),
    keys: () => entries.map(([key]) => key).values(),
    values: () => entries.map(([, value]) => value).values(),
    forEach: (callback, thisArg) => {
      for (const [key, value] of entries) callback.call(thisArg, value, key, fake);
    },
    [Symbol.iterator]: () => entries.values(),
  };
  return fake;
}

describe("formToObject", () => {
  it("carries every entry the caller sent", () => {
    const body = formToObject(
      fakeFormData([
        ["name", "Jane"],
        ["email", "jane@example.com"],
      ]),
    );
    expect(body).toEqual({ name: "Jane", email: "jane@example.com" });
  });

  it("returns an empty bag for an empty form", () => {
    const body = formToObject(fakeFormData([]));
    expect(Object.keys(body)).toEqual([]);
  });

  it("leaves an absent field absent rather than writing an empty string", () => {
    // The property the deleted named-field readers could not hold: `""` for a missing field makes
    // `v.optional` unreachable and turns required-ness into a min-length check.
    const body = formToObject(fakeFormData([["name", "Jane"]]));
    expect(Object.keys(body)).toEqual(["name"]);
    expect(Object.hasOwn(body, "phone")).toBe(false);
    expect("phone" in body).toBe(false);
    expect(body.phone).toBeUndefined();
  });

  it("keeps a field submitted empty distinguishable from one not submitted at all", () => {
    const body = formToObject(
      fakeFormData([
        ["name", "Jane"],
        ["phone", ""],
      ]),
    );
    expect(Object.keys(body)).toEqual(["name", "phone"]);
    expect(body.phone).toBe("");
  });

  it("collects a repeated key into an array in submission order", () => {
    const body = formToObject(
      fakeFormData([
        ["tag", "a"],
        ["tag", "b"],
      ]),
    );
    expect(body.tag).toEqual(["a", "b"]);
  });

  it("keeps appending to the array for a key repeated more than twice", () => {
    const body = formToObject(
      fakeFormData([
        ["tag", "a"],
        ["tag", "b"],
        ["tag", "c"],
        ["tag", "d"],
      ]),
    );
    expect(body.tag).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves a single occurrence as a scalar rather than a one-element array", () => {
    const body = formToObject(fakeFormData([["tag", "a"]]));
    expect(body.tag).toBe("a");
    expect(Array.isArray(body.tag)).toBe(false);
  });

  it("passes a File through as the same instance, uncoerced", () => {
    const file = new File(["hello"], "a.txt", { type: "text/plain" });
    const body = formToObject(fakeFormData([["doc", file]]));
    expect(body.doc).toBe(file);
  });

  it("collects repeated File entries into an array of the same instances", () => {
    const first = new File(["one"], "1.txt");
    const second = new File(["two"], "2.txt");
    const body = formToObject(
      fakeFormData([
        ["doc", first],
        ["doc", second],
      ]),
    );
    expect(body.doc).toEqual([first, second]);
    expect((body.doc as File[])[0]).toBe(first);
    expect((body.doc as File[])[1]).toBe(second);
  });

  it("preserves a File's name, size and bytes through a real FormData", async () => {
    // Bun's FormData hands out a fresh wrapper per read, so identity is not its to give — what is
    // pinned here is that nothing in `formToObject` stringifies or truncates the upload.
    const formData = new FormData();
    formData.append("doc", new File(["hello"], "a.txt", { type: "text/plain" }));
    const body = formToObject(formData);

    expect(body.doc instanceof File).toBe(true);
    const doc = body.doc as File;
    expect(doc.name).toBe("a.txt");
    expect(doc.size).toBe(5);
    expect(await doc.text()).toBe("hello");
  });

  it("returns a bag with no prototype at all", () => {
    const body = formToObject(fakeFormData([["name", "Jane"]]));
    expect(Object.getPrototypeOf(body)).toBe(null);
  });

  it("keeps the bag prototype-less even when the form is empty", () => {
    expect(Object.getPrototypeOf(formToObject(fakeFormData([])))).toBe(null);
  });

  it("gives a caller-sent __proto__ an own key instead of mutating a prototype", () => {
    // Assignment on a prototype-less object cannot reach the inherited `__proto__` setter, so the
    // key lands as data. That is what lets a strict schema see it and refuse it.
    const body = formToObject(
      fakeFormData([
        ["name", "Jane"],
        ["__proto__", "polluted"],
      ]),
    );

    expect(Object.hasOwn(body, "__proto__")).toBe(true);
    // Read through the descriptor: `body.__proto__` would be the deprecated accessor, and on a
    // prototype-less bag it is also the wrong question — ownership is the property being pinned.
    expect(Object.getOwnPropertyDescriptor(body, "__proto__")?.value).toBe("polluted");
    expect(Object.getPrototypeOf(body)).toBe(null);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("reports a field named after an Object.prototype member as absent when it was not sent", () => {
    const body = formToObject(fakeFormData([["name", "Jane"]]));
    for (const inherited of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]) {
      expect(body[inherited]).toBeUndefined();
      expect(inherited in body).toBe(false);
    }
  });

  it("carries a submitted field named after an Object.prototype member as the submitted value", () => {
    const body = formToObject(fakeFormData([["constructor", "Acme Builders"]]));
    expect(body.constructor).toBe("Acme Builders");
  });

  it("omits every name in the drop set", () => {
    const body = formToObject(
      fakeFormData([
        ["_csrf", "tok"],
        ["name", "Jane"],
        ["__surname", ""],
      ]),
      { drop: new Set(["_csrf", "__surname"]) },
    );
    expect(Object.keys(body)).toEqual(["name"]);
  });

  it("drops every occurrence of a repeated dropped key", () => {
    const body = formToObject(
      fakeFormData([
        ["_csrf", "a"],
        ["_csrf", "b"],
        ["name", "Jane"],
      ]),
      { drop: new Set(["_csrf"]) },
    );
    expect(Object.keys(body)).toEqual(["name"]);
  });

  it("treats a drop set naming a field nobody sent as a no-op", () => {
    const body = formToObject(fakeFormData([["name", "Jane"]]), { drop: new Set(["cf-turnstile-response"]) });
    expect(body).toEqual({ name: "Jane" });
  });

  it("keeps every entry when no drop set is supplied", () => {
    const body = formToObject(
      fakeFormData([
        ["_csrf", "tok"],
        ["name", "Jane"],
      ]),
    );
    expect(Object.keys(body)).toEqual(["_csrf", "name"]);
  });

  it("keeps every entry when the drop set is empty", () => {
    const body = formToObject(
      fakeFormData([
        ["_csrf", "tok"],
        ["name", "Jane"],
      ]),
      { drop: new Set() },
    );
    expect(Object.keys(body)).toEqual(["_csrf", "name"]);
  });
});
