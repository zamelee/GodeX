/**
 * Chrome 调试端口查找器
 * 按固定优先级遍历端口，第一个可用即用
 */

import { WebSocket } from "ws";

const DEFAULT_PORTS = [9222, 9223, 9224, 9225];
const CONNECT_TIMEOUT_MS = 1500;

export interface ChromeConnectionInfo {
  port: number;
  wsUrl: string;
  version: string;
  browser: string;
}

/**
 * 检测指定端口是否有 Chrome 调试接口
 */
async function probePort(port: number): Promise<ChromeConnectionInfo | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve(null);
    }, CONNECT_TIMEOUT_MS);

    let resolved = false;
    const wsUrl = `ws://localhost:${port}`;

    const ws = new WebSocket(wsUrl);

    ws.on("open", async () => {
      clearTimeout(timer);
      try {
        ws.send(JSON.stringify({ id: 1, method: "json/version" }));
      } catch {
        if (!resolved) { resolved = true; ws.close(); resolve(null); }
      }
    });

    ws.on("message", (data: Buffer) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === 1 && msg.result) {
            ws.close();
            resolve({
              port,
              wsUrl: msg.result.webSocketDebuggerUrl,
              version: msg.result["Browser-Version"] || "",
              browser: msg.result.Product || "",
            });
          } else {
            ws.close();
            resolve(null);
          }
        } catch {
          ws.close();
          resolve(null);
        }
      }
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

/**
 * 查找第一个可用的 Chrome 调试端口
 * @param ports 自定义端口列表，默认 9222-9225
 * @returns 可用的 Chrome 连接信息，或 null
 */
export async function findChromePort(
  ports: number[] = DEFAULT_PORTS
): Promise<ChromeConnectionInfo | null> {
  for (const port of ports) {
    const info = await probePort(port);
    if (info) {
      return info;
    }
  }
  return null;
}

/**
 * 写端口到注册表（供下次启动复用）
 */
export function savePortToRegistry(port: number): void {
  try {
    const { execSync } = require("child_process");
    const regPath = "HKCU\\Software\\ChromeBrowserMCP";
    execSync(
    `reg add "HKCU\\Software\\ChromeBrowserMCP" /v known-devtools-port /t REG_DWORD /d ${port} /f`, {
      windowsHide: true,
    });
  } catch {
    // 注册表操作失败不影响主流程
  }
}

/**
 * 从注册表读取上次成功的端口
 */
export function loadPortFromRegistry(): number | null {
  try {
    const { execSync } = require("child_process");
    const regPath = "HKCU\\Software\\ChromeBrowserMCP";
    const out = execSync(
      
    `reg query "HKCU\\Software\\ChromeBrowserMCP" /v known-devtools-port`,
      { windowsHide: true }
    ).toString();
    const match = out.match(/known-devtools-port\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
    if (match) {
      return parseInt(match[1], 16) || null;
    }
  } catch {
    // 注册表无值，正常
  }
  return null;
}