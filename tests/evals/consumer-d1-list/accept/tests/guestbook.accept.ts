import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { openBunD1 } from "@y-core/forge/testing/d1/bun";
import type { TestD1 } from "@y-core/forge/testing/d1/bun";

import { createWorker } from "../src/worker";
import { testEnv } from "./env";

let d1: TestD1;

beforeEach(async () => {
  d1 = await openBunD1();
  const insert = d1.binding.prepare("INSERT INTO guestbook_entries (id, name, message, created_at) VALUES (?, ?, ?, ?)");
  await d1.binding.batch(Array.from({ length: 12 }, (_, i) => insert.bind(i + 1, `Guest ${i + 1}`, `Message number ${i + 1}`, 1_000 + i)));
});

afterEach(async () => {
  await d1.dispose();
});

async function visit(path: string): Promise<{ status: number; guests: string[]; hrefs: string[] }> {
  const res = await createWorker({ scriptSrc: ["'self'"] }).request(path, {}, testEnv(d1));
  const html = await res.text();
  const text = html.split(/<[^>]+>/).join(" ");
  return {
    status: res.status,
    guests: [...text.matchAll(/Guest \d+/g)].map((match) => match[0]),
    hrefs: [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((match) => (match[1] ?? "").replaceAll("&amp;", "&")),
  };
}

describe("the guestbook, from outside", () => {
  it("lists the ten newest entries, newest first, and links to the next page", async () => {
    const first = await visit("/guestbook");

    expect(first.status).toBe(200);
    expect(first.guests).toEqual(Array.from({ length: 10 }, (_, i) => `Guest ${12 - i}`));
    expect(first.hrefs.some((href) => /[?&]page=2(&|$)/.test(href))).toBe(true);
  });

  it("serves the two oldest on page two, with no link further on", async () => {
    const second = await visit("/guestbook?page=2");

    expect(second.status).toBe(200);
    expect(second.guests).toEqual(["Guest 2", "Guest 1"]);
    expect(second.hrefs.some((href) => /[?&]page=3(&|$)/.test(href))).toBe(false);
  });

  it("refuses a page that is not a positive whole number with 400", async () => {
    expect([(await visit("/guestbook?page=0")).status, (await visit("/guestbook?page=two")).status]).toEqual([400, 400]);
  });
});
