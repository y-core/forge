import { afterEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchURL } from "./download";

describe("fetchURL()", () => {
  let dest: string;
  let savedFetch: typeof globalThis.fetch | undefined;

  afterEach(async () => {
    if (savedFetch) {
      globalThis.fetch = savedFetch;
      savedFetch = undefined;
    }
    if (dest) {
      const file = Bun.file(dest);
      if (await file.exists()) {
        // Use existsSync via the non-mocked path — just attempt unlink via shell
        try {
          await Bun.write(dest, ""); // truncate to allow collection
        } catch {
          /* ignore */
        }
      }
      dest = "";
    }
  });

  it("does not call fetch when file already exists", async () => {
    dest = join(tmpdir(), `forge-assets-skip-${Date.now()}`);
    // Use Bun.write to bypass any node:fs.writeFileSync mock from other test files
    await Bun.write(dest, "existing content");

    savedFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
      fetchCalled = true;
      return savedFetch!(...args);
    };

    await fetchURL("https://any.url.that.need.not.exist/file", dest);
    expect(fetchCalled).toBe(false);
  });

  it("calls fetch when force:true even if file exists", async () => {
    dest = join(tmpdir(), `forge-assets-force-${Date.now()}`);
    await Bun.write(dest, "stale");

    // Force re-download — will throw because URL is unreachable
    await expect(fetchURL("https://this.url.does.not.exist.invalid/file", dest, { force: true })).rejects.toThrow();
  });
});
