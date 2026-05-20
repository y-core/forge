import { describe, expect, it, mock } from "bun:test";
import { ReleaseError } from "./types";

const mockReadFileSync = mock((_path: string, _enc: string): string => "");
const mockWriteFileSync = mock((_path: string, _data: string, _enc: string): void => {});

mock.module("node:fs", () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: () => true,
}));

const { readPackageVersion, updatePackageVersion } = await import("./pkg");

describe("readPackageVersion()", () => {
  it("returns the version field from package.json", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.2.3" }));
    expect(readPackageVersion("/cwd")).toBe("1.2.3");
  });

  it("throws invalid-version when no version field is present", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg" }));
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
    mockReadFileSync.mockImplementation(() => {
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
    mockReadFileSync.mockReturnValue("");
  });
});

describe("updatePackageVersion()", () => {
  it("writes updated version to package.json", () => {
    const pkg = { name: "pkg", version: "1.2.3" };
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg, null, 2));
    mockWriteFileSync.mockClear();
    updatePackageVersion("1.3.0", "/cwd");
    expect(mockWriteFileSync.mock.calls).toHaveLength(1);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(JSON.parse(written).version).toBe("1.3.0");
  });

  it("preserves other fields", () => {
    const pkg = { name: "my-pkg", version: "1.0.0", description: "test" };
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg, null, 2));
    mockWriteFileSync.mockClear();
    updatePackageVersion("2.0.0", "/cwd");
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.name).toBe("my-pkg");
    expect(written.description).toBe("test");
  });

  it("preserves original indentation", () => {
    const pkg = { name: "pkg", version: "1.0.0" };
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg, null, 4));
    mockWriteFileSync.mockClear();
    updatePackageVersion("1.1.0", "/cwd");
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("    ");
  });

  it("appends trailing newline", () => {
    const pkg = { name: "pkg", version: "1.0.0" };
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg, null, 2));
    mockWriteFileSync.mockClear();
    updatePackageVersion("1.1.0", "/cwd");
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);
  });

  it("throws pkg-update on read failure", () => {
    mockReadFileSync.mockImplementation(() => {
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.0.0" }, null, 2));
  });

  it("throws pkg-update on write failure", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.0.0" }, null, 2));
    mockWriteFileSync.mockImplementation(() => {
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
    mockWriteFileSync.mockReturnValue(undefined);
  });
});
