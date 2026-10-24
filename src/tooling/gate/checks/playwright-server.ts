import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { PlaywrightServerStatus } from "./types";

const TIMEOUT_MS = 3000;

// `fetch` and `WebSocket` can set neither `Upgrade` nor `User-Agent`, and the server answers a version
// mismatch only to the `User-Agent` it reads. The upgrade opens no browser: the socket is dropped on 101.
/** Asks the server at `endpoint` whether a client at `clientVersion` may connect. @internal */
export function playwrightServerStatus(
  endpoint: string,
  clientVersion: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<PlaywrightServerStatus> {
  const url = URL.parse(endpoint);
  const secure = url?.protocol === "wss:" || url?.protocol === "https:";
  if (url === null || !(secure || url.protocol === "ws:" || url.protocol === "http:")) {
    return Promise.resolve({ state: "unreachable", reason: `\`${endpoint}\` is not a ws:// or wss:// URL` });
  }
  url.protocol = secure ? "https:" : "http:";
  const send = secure ? httpsRequest : httpRequest;

  return new Promise((settle) => {
    const req = send(url, {
      headers: {
        ...headers,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
        "User-Agent": `Playwright/${clientVersion}`,
      },
      timeout: TIMEOUT_MS,
    });
    req.on("upgrade", (_response, socket) => {
      socket.destroy();
      settle({ state: "ready" });
    });
    req.on("response", (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => {
        if (response.statusCode !== 428) {
          settle({ state: "unreachable", reason: `the upgrade was answered ${response.statusCode}` });
          return;
        }
        settle({ state: "mismatch", server: /server version: v?([\d.]+)/.exec(body)?.[1] ?? "unknown" });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000} s`)));
    req.on("error", (error) => settle({ state: "unreachable", reason: error.message }));
    req.end();
  });
}
