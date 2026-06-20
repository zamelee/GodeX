// GodeX process + log buffer for Studio
import { spawn as cp_spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";

export interface LogLine {
	ts: number;
	level: "info" | "warn" | "error" | "debug";
	source: "godex" | "studio";
	text: string;
}

interface GodexProc {
	child: ChildProcess | null;
	startTs: number;
}

const MAX_LINES = 1000;
let buffer: LogLine[] = [];
let listeners: Set<(line: LogLine) => void> = new Set();
let godex: GodexProc = { child: null, startTs: 0 };

export function getGodexPort(): number {
	const url = process.env.GODEX_BASE ?? "http://127.0.0.1:5678";
	try { return new URL(url).port ? Number(new URL(url).port) : 5678; }
	catch { return 5678; }
}

export function getGodexBinary(): string {
	return process.env.GODEX_BINARY ?? "D:\\Documents\\VibeCoding\\GodeX\\platforms\\win32-x64\\bin\\godex2.exe";
}

export function getGodexConfig(): string {
	return process.env.GODEX_CONFIG ?? "C:\\Users\\Bliss\\.godex\\config.yaml";
}

export function pushLog(text: string, source: "godex" | "studio" = "studio", level: LogLine["level"] = "info"): void {
	const line: LogLine = { ts: Date.now(), level, source, text };
	buffer.push(line);
	if (buffer.length > MAX_LINES) buffer = buffer.slice(-MAX_LINES);
	for (const l of listeners) {
		try { l(line); } catch {}
	}
}

export function getRecentLogs(limit = 200): LogLine[] {
	return buffer.slice(-limit);
}

export function subscribe(fn: (line: LogLine) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function isGodexRunning(): boolean {
	return godex.child !== null && godex.child.exitCode === null;
}

export function getGodexPid(): number | undefined {
	return godex.child?.pid;
}

export function getGodexStartTs(): number {
	return godex.startTs;
}

export function killGodex(): boolean {
	if (!godex.child) return false;
	const port = getGodexPort();
	try {
		const out = execSync(
			'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Select-Object -First 1"',
			{ encoding: "utf-8" },
		).trim();
		if (out && /^\d+$/.test(out)) {
			try { execSync("taskkill /F /PID " + out, { stdio: "ignore" }); } catch {}
		}
	} catch {}
	if (godex.child && godex.child.exitCode === null) {
		try { godex.child.kill(); } catch {}
	}
	godex.child = null;
	pushLog("[studio] godex killed", "studio", "info");
	return true;
}

export function startGodex(): { ok: true; pid: number } | { ok: false; error: string } {
	const bin = getGodexBinary();
	const cfg = getGodexConfig();
	if (!existsSync(bin)) return { ok: false, error: "binary not found: " + bin };
	if (!existsSync(cfg)) return { ok: false, error: "config not found: " + cfg };
	try {
		const child = cp_spawn(bin, ["--config", cfg, "--log-level", "info"], {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		godex = { child, startTs: Date.now() };
		pushLog("[studio] godex started pid=" + (child.pid ?? "?"), "studio", "info");
		child.stdout?.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString("utf-8").split(/\r?\n/)) {
				if (!line.trim()) continue;
				pushLog(line, "godex", classifyLevel(line));
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString("utf-8").split(/\r?\n/)) {
				if (!line.trim()) continue;
				pushLog(line, "godex", "error");
			}
		});
		child.on("exit", (code, signal) => {
			pushLog("[studio] godex exited code=" + code + " signal=" + signal, "studio", code === 0 ? "info" : "warn");
		});
		return { ok: true, pid: child.pid ?? 0 };
	} catch (e) {
		return { ok: false, error: String((e as Error).message) };
	}
}

function classifyLevel(line: string): LogLine["level"] {
	const l = line.toLowerCase();
	if (l.includes(" error") || l.includes(" error\n") || l.includes("\u274c") || l.includes("err")) return "error";
	if (l.includes(" warn") || l.includes("\u26a0")) return "warn";
	if (l.includes(" debug") || l.includes("\udb80")) return "debug";
	return "info";
}
