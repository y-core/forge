import { afterEach, describe, expect, it } from "bun:test";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";

import { playwrightServerStatus } from "./playwright-server";

let server: Server | undefined;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

const MISMATCH_BODY = "Playwright version mismatch:\n  - server version: v1.64\n  - client version: v1.60\n";

// Node hands every request carrying `Upgrade` to the `upgrade` event, so each answer is written raw there.
function listen(answer: "upgrade" | number, seen: IncomingHttpHeaders[] = []): Promise<string> {
  const listening = createServer();
  server = listening;
  listening.on("upgrade", (req, socket) => {
    seen.push(req.headers);
    if (answer === "upgrade") {
      socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      return;
    }
    const body = answer === 428 ? MISMATCH_BODY : "";
    socket.end(`HTTP/1.1 ${answer} Refused\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
  });
  return new Promise((resolve) => {
    listening.listen(0, "127.0.0.1", () => resolve(`ws://127.0.0.1:${(listening.address() as AddressInfo).port}/`));
  });
}

describe("playwrightServerStatus()", () => {
  it("is ready when the server accepts the upgrade", async () => {
    expect(await playwrightServerStatus(await listen("upgrade"), "1.64.1")).toEqual({ state: "ready" });
  });

  it("introduces itself as the Playwright client at the given version, with the caller's headers", async () => {
    const seen: IncomingHttpHeaders[] = [];
    await playwrightServerStatus(await listen("upgrade", seen), "1.64.1", { "x-token": "abc" });

    expect(seen[0]?.["user-agent"]).toBe("Playwright/1.64.1");
    expect(seen[0]?.["x-token"]).toBe("abc");
  });

  it("reads the server version out of a 428, which is the mismatch answer", async () => {
    expect(await playwrightServerStatus(await listen(428), "1.60.0")).toEqual({ state: "mismatch", server: "1.64" });
  });

  it("is unreachable when the server answers any other status", async () => {
    expect(await playwrightServerStatus(await listen(500), "1.64.1")).toEqual({ state: "unreachable", reason: "the upgrade was answered 500" });
  });

  it("is unreachable when nothing listens on the port", async () => {
    const endpoint = await listen("upgrade");
    server?.close();
    server = undefined;

    expect((await playwrightServerStatus(endpoint, "1.64.1")).state).toBe("unreachable");
  });

  it("is unreachable when the endpoint is not a WebSocket URL, without sending anything", async () => {
    expect(await playwrightServerStatus("playwright:3000", "1.64.1")).toEqual({
      state: "unreachable",
      reason: "`playwright:3000` is not a ws:// or wss:// URL",
    });
  });
});
