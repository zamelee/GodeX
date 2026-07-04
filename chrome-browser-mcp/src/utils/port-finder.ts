/**
 * Chrome 调试端口查找器
 * 先用 HTTP /json/version 探测，再用返回的 webSocketDebuggerUrl 建立 WS 连接验证。
 */

import { WebSocket } from "ws";
import * as http from "node:http";
import { execSync } from "node:child_process";

const DEFAULT_PORTS = [9222, 9223, 9224, 9225];
const CONNECT_TIMEOUT_MS = 1500;

export interface ChromeConnectionInfo {
  port: number;
  wsUrl: string;
  version: string;
  browser: string;
}

async function probePortHttp(port: number): Promise<ChromeConnectionInfo | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS);
    try {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/json/version", timeout: CONNECT_TIMEOUT_MS },
        (resp) => {
          clearTimeout(timer);
          if (resp.statusCode !== 200) { resolve(null); return; }
          let body = "";
          resp.on("data", (c) => (body += c.toString()));
          resp.on("end", () => {
            try {
              const data = JSON.parse(body);
              if (data.webSocketDebuggerUrl) {
                resolve({
                  port,
                  wsUrl: data.webSocketDebuggerUrl,
                  version: data["Browser-Version"] || "",
                  browser: data.Product || "",
                });
              } else { resolve(null); }
            } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => { clearTimeout(timer); resolve(null); });
    } catch { clearTimeout(timer); resolve(null); }
  });
}

async function probePort(port: number): Promise<ChromeConnectionInfo | null> {
  const info = await probePortHttp(port);
  if (!info) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS);
    let resolved = false;
    const ws = new WebSocket(info.wsUrl);
    ws.on("open", () => {
      clearTimeout(timer);
      if (!resolved) { resolved = true; ws.close(); resolve(info); }
    });
    ws.on("error", () => {
      clearTimeout(timer);
      if (!resolved) { resolved = true; resolve(null); }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (!resolved) { resolved = true; resolve(null); }
    });
  });
}

export async function findChromePort(
  ports: number[] = DEFAULT_PORTS
): Promise<ChromeConnectionInfo | null> {
  for (const port of ports) {
    const info = await probePort(port);
    if (info) return info;
  }
  return null;
}

export function savePortToRegistry(port: number): void {
  try {
    execSync(
      `reg add "HKCU\\Software\\ChromeBrowserMCP" /v known-devtools-port /t REG_DWORD /d ${port} /f`,
      { windowsHide: true }
    );
  } catch {}
}

export function loadPortFromRegistry(): number | null {
  try {
    const out = execSync(
      `reg query "HKCU\\Software\\ChromeBrowserMCP" /v known-devtools-port`,
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    ).toString();
    const match = out.match(/known-devtools-port\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
    if (match) return parseInt(match[1], 16) || null;
  } catch {}
  return null;
}
