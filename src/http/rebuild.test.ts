import { describe, expect, it } from "bun:test";

import { rebuildResponse } from "./rebuild";

describe("rebuildResponse", () => {
  it("carries the status, the status text and the body over", async () => {
    const original = new Response("payload", { status: 202, statusText: "Accepted For Later" });

    const res = rebuildResponse(original, new Headers());

    expect(res.status).toBe(202);
    expect(res.statusText).toBe("Accepted For Later");
    expect(await res.text()).toBe("payload");
  });

  it("answers with the headers it is given, keeping each set-cookie value separate", () => {
    const headers = new Headers({ "x-kept": "yes", "cache-control": "private" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");

    const res = rebuildResponse(new Response("body", { headers: { "x-dropped": "yes" } }), headers);

    expect(res.headers.get("x-kept")).toBe("yes");
    expect(res.headers.get("cache-control")).toBe("private");
    expect(res.headers.get("x-dropped")).toBeNull();
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("streams the original body rather than buffering it", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });

    const res = rebuildResponse(new Response(stream), new Headers());

    expect(res.body).not.toBeNull();
    expect(await res.text()).toBe("chunk");
  });

  it("keeps a body-less response body-less", () => {
    expect(rebuildResponse(new Response(null, { status: 204 }), new Headers()).body).toBeNull();
  });
});
