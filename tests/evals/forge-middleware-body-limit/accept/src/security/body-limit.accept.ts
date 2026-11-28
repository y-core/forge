import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { bodyLimit } from "./mod";

function makeApp(maxBytes: number) {
  const app = new Forge();
  app.use("*", bodyLimit({ maxBytes }));
  mapHandler(app, "POST", "/upload", async ({ request }) => new Response(`read ${(await request.arrayBuffer()).byteLength}`));
  return app;
}

function streamed(...chunks: string[]): RequestInit {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { method: "POST", body, duplex: "half" } as RequestInit;
}

describe("bodyLimit, as the security barrel publishes it", () => {
  it("lets a body at the cap through, still readable by the handler", async () => {
    const res = await makeApp(8).request("/upload", { method: "POST", body: "12345678" });

    expect([res.status, await res.text()]).toEqual([200, "read 8"]);
  });

  it("refuses 413 on a Content-Length over the cap", async () => {
    const res = await makeApp(4).request("/upload", { method: "POST", body: "12345", headers: { "Content-Length": "5" } });

    expect(res.status).toBe(413);
  });

  it("refuses 413 on a streamed body with no Content-Length that runs past the cap", async () => {
    const res = await makeApp(4).request("/upload", streamed("123", "456"));

    expect(res.status).toBe(413);
  });

  it("lets a streamed body within the cap through whole", async () => {
    const res = await makeApp(6).request("/upload", streamed("123", "456"));

    expect([res.status, await res.text()]).toEqual([200, "read 6"]);
  });
});
