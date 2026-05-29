import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { readPackageVersion, updatePackageVersion } from "./pkg";
import { ReleaseError } from "./types";

type FsSpy = ReturnType<typeof spyOn> & {
  mockReturnValue: (v: unknown) => void;
  mockImplementation: (fn: (...args: unknown[]) => unknown) => void;
};

let readSpy: FsSpy;
let writeSpy: FsSpy;

beforeEach(() => {
  readSpy = spyOn(fs, "readFileSync") as FsSpy;
  writeSpy = spyOn(fs, "writeFileSync") as FsSpy;
  readSpy.mockReturnValue("");
  writeSpy.mockReturnValue(undefined);
});

afterAll(() => {
  readSpy.mockRestore();
  writeSpy.mockRestore();
});

describe("readPackageVersion()", () => {
  it("returns the version field from package.json", () => {
    readSpy.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.2.3" }));
    expect(readPackageVersion("/cwd")).toBe("1.2.3");
  });

  it("throws invalid-version when no version field is present", () => {
    readSpy.mockReturnValue(JSON.stringify({ name: "pkg" }));
    let thrown: ReleaseError | null = null;
    try {
      readPackageVersion("/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("invalid-version");
  });

  it("throws invalid-version when readFileSync throws", () => {
    readSpy.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    let thrown: ReleaseError | null = null;
    try {
      readPackageVersion("/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("invalid-version");
    readSpy.mockReturnValue("");
  });
});

describe("updatePackageVersion()", () => {
  it("writes updated version to package.json", () => {
    const pkg = { name: "pkg", version: "1.2.3" };
    readSpy.mockReturnValue(JSON.stringify(pkg, null, 2));
    writeSpy.mockClear();
    updatePackageVersion("1.3.0", "/cwd");
    expect(writeSpy.mock.calls).toHaveLength(1);
    const written = writeSpy.mock.calls[0][1] as string;
    expect(JSON.parse(written).version).toBe("1.3.0");
  });

  it("preserves other fields", () => {
    const pkg = { name: "my-pkg", version: "1.0.0", description: "test" };
    readSpy.mockReturnValue(JSON.stringify(pkg, null, 2));
    writeSpy.mockClear();
    updatePackageVersion("2.0.0", "/cwd");
    const written = JSON.parse(writeSpy.mock.calls[0][1] as string);
    expect(written.name).toBe("my-pkg");
    expect(written.description).toBe("test");
  });

  it("preserves original indentation", () => {
    const pkg = { name: "pkg", version: "1.0.0" };
    readSpy.mockReturnValue(JSON.stringify(pkg, null, 4));
    writeSpy.mockClear();
    updatePackageVersion("1.1.0", "/cwd");
    const written = writeSpy.mock.calls[0][1] as string;
    expect(written).toContain("    ");
  });

  it("appends trailing newline", () => {
    const pkg = { name: "pkg", version: "1.0.0" };
    readSpy.mockReturnValue(JSON.stringify(pkg, null, 2));
    writeSpy.mockClear();
    updatePackageVersion("1.1.0", "/cwd");
    const written = writeSpy.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);
  });

  it("throws pkg-update on read failure", () => {
    readSpy.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    let thrown: ReleaseError | null = null;
    try {
      updatePackageVersion("1.3.0", "/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("pkg-update");
    readSpy.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.0.0" }, null, 2));
  });

  it("throws pkg-update on write failure", () => {
    readSpy.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.0.0" }, null, 2));
    writeSpy.mockImplementation(() => {
      throw new Error("EACCES");
    });
    let thrown: ReleaseError | null = null;
    try {
      updatePackageVersion("1.3.0", "/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("pkg-update");
    writeSpy.mockReturnValue(undefined);
  });
});
