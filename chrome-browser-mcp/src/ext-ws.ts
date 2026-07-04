/**
 * Extension WebSocket Server
 * Extension service_worker connects here via ws://localhost:9225/ext
 * MCP routes commands to extension via this WS when extension is available.
 */

import { WebSocketServer, WebSocket } from "ws";

const WS_PORT = 9225;
const REQUEST_TIMEOUT_MS = 15000;

let wss: WebSocketServer | null = null;
let extSocket: WebSocket | null = null;

export function startExtWsServer(): void {
  if (wss) return;
  wss = new WebSocketServer({ port: WS_PORT, path: "/ext" });
  wss.on("connection", (ws) => {
    console.error("[ext-ws] Extension connected");
    extSocket = ws;
    ws.on("close", () => {
      console.error("[ext-ws] Extension disconnected");
      if (extSocket === ws) extSocket = null;
    });
    ws.on("error", (err) => {
      console.error("[ext-ws] WS error:", err.message);
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.error("[ext-ws] <-", msg.id, msg.success ? "OK" : "ERR:" + msg.error);
      } catch {}
    });
  });
  wss.on("listening", () => {
    console.error("[ext-ws] Listening on ws://localhost:" + WS_PORT + "/ext");
  });
  wss.on("error", (err) => {
    console.error("[ext-ws] Server error:", err.message);
  });
}

export function extIsConnected(): boolean {
  return extSocket !== null && extSocket.readyState === WebSocket.OPEN;
}

export function extSend(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!extSocket || extSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Extension not connected");
  }
  const id = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      extSocket!.off("message", onMessage);
      reject(new Error("Extension request timeout"));
    }, REQUEST_TIMEOUT_MS);

    function onMessage(data: WebSocket.RawData) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          extSocket!.off("message", onMessage);
          if (msg.success) resolve(msg.result);
          else reject(new Error(msg.error || "Extension execution failed"));
        }
      } catch {}
    }

    extSocket!.on("message", onMessage);
    const req = { id, type: "exec", action, args };
    extSocket!.send(JSON.stringify(req));
  });
}
