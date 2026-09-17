import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The largest remote asset a build accepts, so a compromised host cannot fill the runner's disk. */
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

/** A full SHA-256 in lowercase hex — a truncated digest pins nothing. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads a response body, abandoning it the moment it passes `limit` bytes. */
async function readCapped(response: Response, url: string, limit: number): Promise<Uint8Array> {
  // Read in chunks rather than through `arrayBuffer`: a host answering without a `content-length`
  // would otherwise be buffered whole before any cap could look at it.
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`[forge-assets] ${url}: over the ${limit}-byte cap`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** The hops one download may take before the chain is called a loop. */
const MAX_REDIRECTS = 10;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Every hop, not only the last: `redirect: "follow"` reports one `response.url`, so an
// https → http → https bounce reaches the cap having leaked the request over cleartext unseen.
/** Walks the redirect chain itself, refusing the first hop that leaves https. */
async function followHttps(url: string): Promise<Response> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(target, { redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (location === null) return response;
    const next = new URL(location, target).href;
    if (!next.startsWith("https://")) {
      throw new Error(`[forge-assets] ${url}: redirected to ${next} — only https:// URLs may be downloaded`);
    }
    target = next;
  }
  throw new Error(`[forge-assets] ${url}: more than ${MAX_REDIRECTS} redirects`);
}

/** Downloads `url` to `dest` over https, writing only bytes whose SHA-256 is `opts.sha256`. @public */
export async function fetchURL(url: string, dest: string, opts: { sha256: string; force?: boolean; maxBytes?: number }): Promise<void> {
  if (!url.startsWith("https://")) {
    throw new Error(`[forge-assets] ${url}: only https:// URLs may be downloaded`);
  }

  const expected = opts.sha256.toLowerCase();
  if (!SHA256_HEX.test(expected)) {
    throw new Error(`[forge-assets] ${url}: sha256 must be 64 hex characters, got "${opts.sha256}"`);
  }

  // A file already on disk is a cache an earlier build wrote, so it is re-read rather than trusted:
  // skipping the check is what would make one poisoned copy permanent.
  if (!opts.force && existsSync(dest) && digestOf(readFileSync(dest)) === expected) return;

  const limit = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const response = await followHttps(url);
  if (!response.ok) throw new Error(`[forge-assets] fetch ${url}: ${response.status} ${response.statusText}`);

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`[forge-assets] ${url}: declares ${declared} bytes, over the ${limit}-byte cap`);
  }

  const bytes = await readCapped(response, url, limit);
  const actual = digestOf(bytes);
  if (actual !== expected) {
    throw new Error(`[forge-assets] ${url}: sha256 mismatch — expected ${expected}, got ${actual}`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
}
