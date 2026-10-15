import { connect } from "node:net";

import { expect, harnessTest } from "./harness.fixture";

const test = harnessTest({ config: new URL("../fixtures/workers-websocket/wrangler.jsonc", import.meta.url).pathname });

// A 500 in place of the 101 has been seen intermittently; the Worker's own record is what tells a runtime fault from a proxy one.
test.afterEach(async ({ served }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("worker-logs", { body: JSON.stringify(served.harness.getLogs(), null, 2), contentType: "application/json" });
  served.harness.debug();
});

function echo(origin: string, path: string): Promise<string> {
  const socket = new WebSocket(`${origin.replace(/^http/, "ws")}${path}`);
  return new Promise<string>((resolve, reject) => {
    socket.addEventListener("open", () => socket.send("ping"));
    socket.addEventListener("message", (event) => {
      resolve(String(event.data));
      socket.close();
    });
    socket.addEventListener("error", () => reject(new Error(`socket on ${path} failed to open`)));
  });
}

// The WebSocket API hides the handshake response, so the headers are read off a raw one.
function handshakeHead(origin: string, path: string): Promise<string> {
  const { hostname, port } = new URL(origin);
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

test.describe("a 101 behind forge's response rebuilds", () => {
  test("opens the socket and echoes a frame through the middleware", async ({ served }) => {
    expect(await echo(served.origin, "/live")).toBe("echo:ping");
  });

  test("opens the socket and echoes a frame when a definePage loader returns it", async ({ served }) => {
    expect(await echo(served.origin, "/page-live")).toBe("echo:ping");
  });

  test("carries the queued cookie, a security header and the CORS answer on the handshake", async ({ served }) => {
    const head = await handshakeHead(served.origin, "/live");

    expect(head).toMatch(/^http\/1\.1 101/);
    expect(head).toContain("\r\nset-cookie: seen=1; path=/");
    expect(head).toContain("\r\nx-content-type-options: nosniff");
    expect(head).toContain("\r\naccess-control-allow-origin: https://example.com");
  });

  test("carries the page's own header on a definePage handshake", async ({ served }) => {
    const head = await handshakeHead(served.origin, "/page-live");

    expect(head).toMatch(/^http\/1\.1 101/);
    expect(head).toContain("\r\nx-page: live");
  });
});
