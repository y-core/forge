/** True when the request asks to switch to the WebSocket protocol. @public */
export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get("Upgrade");
  return upgrade !== null && upgrade.split(",").some((token) => token.trim().toLowerCase() === "websocket");
}
