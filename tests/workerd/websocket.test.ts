import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connect } from "node:net";

import { type DevServer, startDevServer } from "@y-core/forge/testing/workerd";

const CONFIG = new URL("../fixtures/workers-websocket/wrangler.jsonc", import.meta.url).pathname;

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer({ config: CONFIG, readyPath: "/live" });
}, 400_000);

afterAll(() => server?.stop());

function echo(path: string): Promise<string> {
  const socket = new WebSocket(`${server.origin.replace(/^http/, "ws")}${path}`);
  return new Promise<string>((resolve, reject) => {
    socket.addEventListener("open", () => socket.send("ping"));
    socket.addEventListener("message", (event) => {
      resolve(String(event.data));
      socket.close();
    });
    socket.addEventListener("error", () => reject(new Error(`socket on ${path} failed to open`)));
  });
}

// Bun's WebSocket hides the handshake response, so the headers are read off a raw one.
function handshakeHead(path: string): Promise<string> {
  const { hostname, port } = new URL(server.origin);
  return new Promise<string>((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nOrigin: https://example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      const end = received.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.destroy();
      resolve(received.slice(0, end).toLowerCase());
    });
    socket.on("error", reject);
  });
}

describe("a 101 behind forge's response rebuilds", () => {
  it("opens the socket and echoes a frame through the middleware", async () => {
    expect(await echo("/live")).toBe("echo:ping");
  });

  it("opens the socket and echoes a frame when a definePage loader returns it", async () => {
    expect(await echo("/page-live")).toBe("echo:ping");
  });

  it("carries the queued cookie, a security header and the CORS answer on the handshake", async () => {
    const head = await handshakeHead("/live");

    expect(head).toStartWith("http/1.1 101");
    expect(head).toContain("\r\nset-cookie: seen=1; path=/");
    expect(head).toContain("\r\nx-content-type-options: nosniff");
    expect(head).toContain("\r\naccess-control-allow-origin: https://example.com");
  });

  it("carries the page's own header on a definePage handshake", async () => {
    const head = await handshakeHead("/page-live");

    expect(head).toStartWith("http/1.1 101");
    expect(head).toContain("\r\nx-page: live");
  });
});
