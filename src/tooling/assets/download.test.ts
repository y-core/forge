import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchURL } from "./download";

/** The pin a caller would write into config for `content`. */
function pin(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

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
        try {
          await Bun.write(dest, ""); // truncate to allow collection
        } catch {
          /* ignore */
        }
      }
      dest = "";
    }
  });

  it("does not call fetch when the file on disk already matches the pin", async () => {
    dest = join(tmpdir(), `forge-assets-skip-${Date.now()}`);
    // Bun.write bypasses any node:fs.writeFileSync mock left installed by another test file.
    await Bun.write(dest, "existing content");

    savedFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
      fetchCalled = true;
      return savedFetch!(...args);
    };

    await fetchURL("https://any.url.that.need.not.exist/file", dest, { sha256: pin("existing content") });
    expect(fetchCalled).toBe(false);
  });

  // The cache is the supply chain's weakest link: skipping the check is what would make one poisoned
  // copy permanent, since nothing later in the build ever looks at those bytes again.
  it("re-fetches a file on disk whose digest no longer matches the pin", async () => {
    dest = join(tmpdir(), `forge-assets-poisoned-${Date.now()}`);
    await Bun.write(dest, "poisoned by an earlier build");

    const spy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("clean", { status: 200 }));
    try {
      await fetchURL("https://cdn.example.com/file", dest, { sha256: pin("clean") });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await Bun.file(dest).text()).toBe("clean");
    } finally {
      spy.mockRestore();
    }
  });

  it("calls fetch when force:true even if the file matches", async () => {
    dest = join(tmpdir(), `forge-assets-force-${Date.now()}`);
    await Bun.write(dest, "stale");

    await expect(fetchURL("https://this.url.does.not.exist.invalid/file", dest, { sha256: pin("stale"), force: true })).rejects.toThrow();
  });

  it("refuses an http:// URL without fetching it", async () => {
    dest = join(tmpdir(), `forge-assets-cleartext-${Date.now()}`);
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 200 }));
    try {
      await expect(fetchURL("http://cdn.example.com/font.woff2", dest, { sha256: pin("x") })).rejects.toThrow(
        "[forge-assets] http://cdn.example.com/font.woff2: only https:// URLs may be downloaded",
      );
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });

  /** A fetch answering one scripted hop per call, recording the URL each was requested from. */
  function chain(hops: readonly Response[]): { spy: ReturnType<typeof spyOn>; asked: string[] } {
    const asked: string[] = [];
    let at = 0;
    const spy = spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      asked.push(String(input));
      const hop = hops[Math.min(at, hops.length - 1)];
      at += 1;
      return Promise.resolve(hop!.clone());
    });
    return { spy, asked };
  }

  function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { location } });
  }

  // The input URL was checked before the fetch and nothing checked where the bytes came from, so a
  // host answering `Location: http://…` moved the whole download onto cleartext unnoticed.
  it("refuses a redirect off https rather than following it", async () => {
    dest = join(tmpdir(), `forge-assets-downgrade-${Date.now()}`);
    const { spy } = chain([redirect("http://cdn.example.com/font.woff2")]);
    try {
      await expect(fetchURL("https://cdn.example.com/font.woff2", dest, { sha256: pin("x") })).rejects.toThrow(
        "[forge-assets] https://cdn.example.com/font.woff2: redirected to http://cdn.example.com/font.woff2 — only https:// URLs may be downloaded",
      );
      expect(await Bun.file(dest).exists()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  // Every hop is judged, not the one the bytes arrived from: a chain that dips through http and
  // returns reports an https `response.url`, so the leaked request is invisible at the end of it.
  it("refuses a cleartext hop in the middle of a chain that ends back on https", async () => {
    dest = join(tmpdir(), `forge-assets-bounce-${Date.now()}`);
    const { spy, asked } = chain([redirect("http://mirror.example.com/hop"), redirect("https://cdn.example.com/font.woff2")]);
    try {
      await expect(fetchURL("https://cdn.example.com/font.woff2", dest, { sha256: pin("x") })).rejects.toThrow(
        "redirected to http://mirror.example.com/hop",
      );
      expect(asked).toEqual(["https://cdn.example.com/font.woff2"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("follows a redirect that stays on https, resolving a relative Location", async () => {
    dest = join(tmpdir(), `forge-assets-redirect-${Date.now()}`);
    const { spy, asked } = chain([redirect("/mirror/font.woff2"), new Response("trusted", { status: 200 })]);
    try {
      await fetchURL("https://cdn.example.com/font.woff2", dest, { sha256: pin("trusted") });
      expect(await Bun.file(dest).text()).toBe("trusted");
      expect(asked).toEqual(["https://cdn.example.com/font.woff2", "https://cdn.example.com/mirror/font.woff2"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a redirect loop rather than following it forever", async () => {
    dest = join(tmpdir(), `forge-assets-loop-${Date.now()}`);
    const { spy, asked } = chain([redirect("https://cdn.example.com/font.woff2")]);
    try {
      await expect(fetchURL("https://cdn.example.com/font.woff2", dest, { sha256: pin("x") })).rejects.toThrow("more than 10 redirects");
      expect(asked.length).toBe(11);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a digest that is not a full SHA-256", async () => {
    dest = join(tmpdir(), `forge-assets-shortpin-${Date.now()}`);
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 200 }));
    try {
      await expect(fetchURL("https://cdn.example.com/x", dest, { sha256: "deadbeef" })).rejects.toThrow(/sha256 must be 64 hex characters/);
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("writes nothing when the fetched bytes do not match the pin", async () => {
    dest = join(tmpdir(), `forge-assets-mismatch-${Date.now()}`);
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("tampered", { status: 200 }));
    try {
      await expect(fetchURL("https://cdn.example.com/icon.svg", dest, { sha256: pin("expected") })).rejects.toThrow(/sha256 mismatch/);
      expect(await Bun.file(dest).exists()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("writes the bytes when they match the pin", async () => {
    dest = join(tmpdir(), `forge-assets-ok-${Date.now()}`);
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("trusted", { status: 200 }));
    try {
      await fetchURL("https://cdn.example.com/icon.svg", dest, { sha256: pin("trusted") });
      expect(await Bun.file(dest).text()).toBe("trusted");
    } finally {
      spy.mockRestore();
    }
  });

  // The cap has to bite while the body is still arriving: a host answering without a `content-length`
  // would otherwise be buffered whole first, which is the case the cap exists for.
  it("stops reading an undeclared oversize body instead of buffering it whole", async () => {
    dest = join(tmpdir(), `forge-assets-stream-${Date.now()}`);
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        controller.enqueue(new Uint8Array(8));
      },
    });
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));
    try {
      await expect(fetchURL("https://cdn.example.com/endless", dest, { sha256: "a".repeat(64), maxBytes: 32 })).rejects.toThrow(
        /over the 32-byte cap/,
      );
      expect(emitted).toBeLessThan(16);
      expect(await Bun.file(dest).exists()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a body over the size cap, and the declared length before reading one", async () => {
    dest = join(tmpdir(), `forge-assets-toobig-${Date.now()}`);
    const body = "x".repeat(64);
    const declared = spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200, headers: { "content-length": "999999" } }));
    try {
      await expect(fetchURL("https://cdn.example.com/big", dest, { sha256: pin(body), maxBytes: 16 })).rejects.toThrow(/declares 999999 bytes/);
    } finally {
      declared.mockRestore();
    }

    const undeclared = spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));
    try {
      await expect(fetchURL("https://cdn.example.com/big", dest, { sha256: pin(body), maxBytes: 16 })).rejects.toThrow(/over the 16-byte cap/);
      expect(await Bun.file(dest).exists()).toBe(false);
    } finally {
      undeclared.mockRestore();
    }
  });
});
