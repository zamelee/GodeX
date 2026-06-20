// GodeX Studio — Layer 4 UI Server

import { spawn as cp_spawn, execSync } from "node:child_process";
import {
	existsSync,
	readFileSync as fs_read,
	writeFileSync as fs_write,
} from "node:fs";
import { resolve } from "node:path";

const GODEX_BASE = process.env.GODEX_BASE ?? "http://127.0.0.1:5678";
const PORT = Number(process.env.STUDIO_PORT ?? "56791");
const TRACE_DB_PATH =
	process.env.GODEX_TRACE_DB ??
	(process.env.GODEX_DATA
		? resolve(process.env.GODEX_DATA, "trace.db")
		: "C:\\Users\\Bliss\\.godex\\data\\trace.db");
const GODEX_CONFIG =
	process.env.GODEX_CONFIG ?? "C:\\Users\\Bliss\\.godex\\config.yaml";
const GODEX_BINARY =
	process.env.GODEX_BINARY ??
	"D:\\Documents\\VibeCoding\\GodeX\\platforms\\win32-x64\\bin\\godex2.exe";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};
const JSON_H = { "Content-Type": "application/json", ...CORS };
const HTML_H = { "Content-Type": "text/html; charset=utf-8", ...CORS };

interface TraceRow {
	created_at: number;
	event_name: string;
	request_id: string;
	provider?: string;
	model?: string;
	message?: string;
}

async function queryTraceLogs(limit = 60): Promise<TraceRow[]> {
	try {
		const { DatabaseSync } = await import("bun");
		if (!existsSync(TRACE_DB_PATH)) return [];
		const db = new DatabaseSync(TRACE_DB_PATH);
		const rows = db
			.query(
				"SELECT created_at, event_name, request_id, provider, model, message FROM trace_events ORDER BY created_at DESC LIMIT ?",
			)
			.all(limit) as TraceRow[];
		db.close();
		return rows;
	} catch {
		return [];
	}
}

async function proxyToGodex(path: string, timeoutMs = 5000): Promise<Response> {
	try {
		const r = await fetch(GODEX_BASE + path, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		return new Response(await r.text(), { headers: JSON_H });
	} catch (e: unknown) {
		return new Response(
			JSON.stringify({ error: String((e as Error).message) }),
			{ status: 502, headers: JSON_H },
		);
	}
}

// Parse existing aliases from config.yaml (simple regex parser)
function readExistingAliases(): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(GODEX_CONFIG)) return out;
	try {
		const raw = fs_read(GODEX_CONFIG, "utf-8");
		const m = raw.match(/aliases:\s*\n([\s\S]*?)(?:\n[a-z]|$)/);
		if (m) {
			for (const line of m[1].split("\n")) {
				const am = line.match(/^\s+['"]([^'"]+)['"]\s*:\s*(\S+)\s*$/);
				if (am) out[am[1]] = am[2];
			}
		}
	} catch {}
	return out;
}

function readAllProviders(): Array<{
	name: string;
	spec: string;
	api_key: string;
	base_url: string;
	timeout_ms: number;
}> {
	const out = [];
	if (!existsSync(GODEX_CONFIG)) return out;
	try {
		const raw = fs_read(GODEX_CONFIG, "utf-8");
		const pm = raw.match(/providers:\s*\n([\s\S]*?)(?:\n[a-zA-Z]|$)/);
		if (!pm) return out;
		const body = pm[1];
		// Split blocks at lines starting with two spaces + name + colon
		const blocks = body.split(/\n(?= {2}[A-Za-z0-9_-]+:\s*\n)/);
		for (const block of blocks) {
			const nm = block.match(/^ {2}([A-Za-z0-9_-]+):\s*\n/);
			if (!nm) continue;
			const name = nm[1];
			const specM = block.match(/spec:\s*(\S+)/);
			const baseM = block.match(/base_url:\s*(\S+)/);
			const timeoutM = block.match(/timeout_ms:\s*(\d+)/);
			const apiKeyM = block.match(/api_key:\s*(\S+)/);
			out.push({
				name,
				spec: specM ? specM[1] : name,
				base_url: baseM ? baseM[1] : "",
				timeout_ms: timeoutM ? parseInt(timeoutM[1], 10) : 120000,
				api_key: apiKeyM ? apiKeyM[1] : "",
			});
		}
	} catch {}
	return out;
}

function upsertProvider(
	name: string,
	baseUrl: string,
	apiKey: string,
	timeoutMs: number,
	spec: string,
): void {
	let raw = existsSync(GODEX_CONFIG) ? fs_read(GODEX_CONFIG, "utf-8") : "";
	if (!raw || !/^server:/m.test(raw)) {
		raw = [
			"server:",
			"  port: " + (new URL(GODEX_BASE).port || "5678"),
			"  host: 127.0.0.1",
			"default_provider: " + name,
			"providers:",
			"",
			"models:",
			"  aliases:",
			"",
			"session:",
			"  backend: sqlite",
			"logging:",
			"  level: info",
			"trace:",
			"  capture_payload: true",
			"",
		].join("\n");
	}
	const newBlock =
		"  " +
		name +
		":\n" +
		"    spec: " +
		(spec || name) +
		"\n" +
		"    credentials:\n" +
		"      api_key: " +
		(apiKey || "") +
		"\n" +
		"    endpoint:\n" +
		"      base_url: " +
		(baseUrl || "https://api.example.com/v1") +
		"\n" +
		"    timeout_ms: " +
		(timeoutMs || 120000) +
		"\n";

	const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		"( {2}" + nameEsc + ":\\n[\\s\\S]*?)(?=\\n {2}[^\\s]|\\n[a-zA-Z]|\\Z)",
	);
	if (re.test(raw)) {
		raw = raw.replace(re, newBlock);
	} else if (/providers:\s*\n/.test(raw)) {
		raw = raw.replace(/providers:\s*\n/, "providers:\n" + newBlock);
	} else {
		raw = raw.replace(/^(server:[\s\S]*?\n)/, "$1providers:\n" + newBlock);
	}
	if (!/default_provider:\s*\S+/.test(raw)) {
		raw = raw.replace(
			/^(server:[\s\S]*?\n)/,
			"$1default_provider: " + name + "\n",
		);
	} else {
		raw = raw.replace(/default_provider:\s*\S+/, "default_provider: " + name);
	}
	fs_write(GODEX_CONFIG, raw, "utf-8");
}

function writeConfigYaml(
	provider: string,
	baseUrl: string,
	apiKey: string,
	timeoutMs: number,
	aliases: Record<string, string>,
): void {
	// Preserve existing providers and only upsert the active one.
	upsertProvider(provider, baseUrl, apiKey, timeoutMs, provider);
	// Then merge aliases on top.
	let raw = fs_read(GODEX_CONFIG, "utf-8");
	const aliasesYaml = Object.entries(aliases)
		.map(([k, v]) => '    "' + k + '": ' + v)
		.join("\n");
	const aliasBlock =
		"models:\n  aliases:\n" + (aliasesYaml ? aliasesYaml + "\n" : "");
	if (/models:\s*\n {2}aliases:/.test(raw)) {
		raw = raw.replace(
			/models:\s*\n {2}aliases:\n[\s\S]*?(?=\n[a-zA-Z]|Z)/,
			aliasBlock,
		);
	} else {
		raw = raw.replace(
			/(providers:\s*\n[\s\S]*?)(?=\n[a-zA-Z]|Z)/,
			"$1\n" + aliasBlock,
		);
	}
	fs_write(GODEX_CONFIG, raw, "utf-8");
}

function killExistingGodex(): void {
	const port = new URL(GODEX_BASE).port || "5678";
	try {
		const out = execSync(
			'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ' +
				port +
				' -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Select-Object -First 1"',
			{ encoding: "utf-8" },
		).trim();
		if (out && /^\d+$/.test(out)) {
			try {
				execSync("taskkill /F /PID " + out, { stdio: "ignore" });
			} catch {}
		}
	} catch {}
}

function startNewGodex(): number | undefined {
	if (!existsSync(GODEX_BINARY))
		throw new Error("binary not found: " + GODEX_BINARY);
	const child = cp_spawn(GODEX_BINARY, [], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
	return child.pid;
}

async function applyConfig(body: {
	provider?: string;
	base_url?: string;
	api_key?: string;
	timeout_ms?: number;
	alias_default?: string;
	alias_target?: string;
}) {
	const provider = body.provider || "minimax";
	const baseUrl = body.base_url || "https://api.example.com/v1";
	const apiKey = body.api_key || "";
	const timeoutMs = body.timeout_ms || 60000;
	const aliasDefault = body.alias_default || provider + "-model";
	const aliasTarget = body.alias_target || provider + "/Model";

	const aliases = readExistingAliases();
	aliases[aliasDefault] = aliasTarget;
	if (!aliases["*"]) aliases["*"] = aliasTarget;

	try {
		writeConfigYaml(provider, baseUrl, apiKey, timeoutMs, aliases);
	} catch (e: unknown) {
		return { ok: false, error: "write failed: " + (e as Error).message };
	}

	killExistingGodex();
	await new Promise((r) => setTimeout(r, 1500));

	try {
		const pid = startNewGodex();
		return { ok: true, pid, config_path: GODEX_CONFIG };
	} catch (e: unknown) {
		return { ok: false, error: "start failed: " + (e as Error).message };
	}
}

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;
		if (req.method === "OPTIONS")
			return new Response(null, { headers: { ...CORS } });
		if (path === "/" || path === "/index.html")
			return new Response(loadHTML(), { headers: HTML_H });
		if (path === "/api/health" || path === "/health")
			return proxyToGodex("/health", 3000);
		if (path === "/api/v1/models" || path === "/v1/models")
			return proxyToGodex("/v1/models", 8000);
		if (path === "/api/logs" && req.method === "GET")
			return new Response(JSON.stringify(await queryTraceLogs(60)), {
				headers: JSON_H,
			});
		if (path === "/api/config" && req.method === "POST") {
			try {
				const body = (await req.json()) as Record<string, unknown>;
				const result = await applyConfig(
					body as {
						provider?: string;
						base_url?: string;
						api_key?: string;
						timeout_ms?: number;
						alias_default?: string;
						alias_target?: string;
					},
				);
				return new Response(JSON.stringify(result), { headers: JSON_H });
			} catch (e: unknown) {
				return new Response(
					JSON.stringify({ ok: false, error: (e as Error).message }),
					{ status: 400, headers: JSON_H },
				);
			}
		}
		// GET /api/providers - read all providers from config.yaml
		if (path === "/api/providers" && req.method === "GET") {
			try {
				return new Response(JSON.stringify(readAllProviders()), {
					headers: JSON_H,
				});
			} catch (e) {
				return new Response(
					JSON.stringify({ error: String((e as Error).message) }),
					{ status: 500, headers: JSON_H },
				);
			}
		}

		// POST /api/providers
		if (path === "/api/providers" && req.method === "POST") {
			try {
				const body = await req.json();
				const name = body.name;
				if (!name)
					return new Response(
						JSON.stringify({ ok: false, error: "name required" }),
						{ status: 400, headers: JSON_H },
					);
				const baseUrl = body.base_url || "";
				const apiKey = body.api_key || "";
				const spec = body.spec || "minimax";
				const timeoutMs = body.timeout_ms || 120000;
				const newBlock =
					"  " +
					name +
					":\n    spec: " +
					spec +
					"\n    credentials:\n      api_key: " +
					apiKey +
					"\n    endpoint:\n      base_url: " +
					baseUrl +
					"\n    timeout_ms: " +
					timeoutMs +
					"\n";
				let raw = existsSync(GODEX_CONFIG)
					? fs_read(GODEX_CONFIG, "utf-8")
					: "server:\n  port: 5678\nproviders:\n" + newBlock;
				if (!existsSync(GODEX_CONFIG)) {
					fs_write(GODEX_CONFIG, raw, "utf-8");
					return new Response(JSON.stringify({ ok: true }), {
						headers: JSON_H,
					});
				}
				const nameEsc = name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
				const re = new RegExp(
					"(\\n|^)( {2}" +
						nameEsc +
						":\\n[\\s\\S]*?)(?=\\n {2}[^\\s]|\\n[a-z]|\\Z)",
				);
				if (re.test(raw)) {
					raw = raw.replace(re, (_m, prefix) => prefix + newBlock);
				} else {
					raw = raw.replace(/(providers:\s*\n)/, "$1" + newBlock);
				}
				fs_write(GODEX_CONFIG, raw, "utf-8");
				return new Response(JSON.stringify({ ok: true }), { headers: JSON_H });
			} catch (e) {
				return new Response(
					JSON.stringify({ ok: false, error: String((e as Error).message) }),
					{ status: 400, headers: JSON_H },
				);
			}
		}

		// DELETE /api/providers/:name
		if (path.startsWith("/api/providers/") && req.method === "DELETE") {
			try {
				const name = decodeURIComponent(path.slice("/api/providers/".length));
				if (!existsSync(GODEX_CONFIG))
					return new Response(
						JSON.stringify({ ok: false, error: "no config" }),
						{ status: 404, headers: JSON_H },
					);
				let raw = fs_read(GODEX_CONFIG, "utf-8");
				const nameEsc = name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
				const re = new RegExp(
					"\\n {2}" + nameEsc + ":\\n[\\s\\S]*?(?=\\n {2}[^\\s]|\\n[a-z]|\\Z)",
				);
				if (!re.test(raw))
					return new Response(
						JSON.stringify({ ok: false, error: "not found" }),
						{ status: 404, headers: JSON_H },
					);
				raw = raw.replace(re, "");
				fs_write(GODEX_CONFIG, raw, "utf-8");
				return new Response(JSON.stringify({ ok: true }), { headers: JSON_H });
			} catch (e) {
				return new Response(
					JSON.stringify({ ok: false, error: String((e as Error).message) }),
					{ status: 400, headers: JSON_H },
				);
			}
		}

		// GET /api/upstream-models

		// GET /api/all-models - list models from all configured providers
		if (path === "/api/all-models" && req.method === "GET") {
			try {
				const providers = readAllProviders();
				const results = await Promise.all(
					providers.map(async (p) => {
						if (!p.base_url)
							return {
								name: p.name,
								spec: p.spec,
								models: [],
								error: "no base_url",
							};
						try {
							const headers: Record<string, string> = {};
							if (p.api_key) headers["Authorization"] = "Bearer " + p.api_key;
							const url = p.base_url.replace(/[\\/]+$/, "") + "/models";
							const r = await fetch(url, {
								headers,
								signal: AbortSignal.timeout(8000),
							});
							if (!r.ok)
								return {
									name: p.name,
									spec: p.spec,
									models: [],
									error: "upstream " + r.status,
								};
							const data = (await r.json()) as { data?: Array<{ id: string }> };
							const models = (data.data || []).map((m) => ({
								id: m.id,
								name: m.id,
							}));
							return { name: p.name, spec: p.spec, models };
						} catch (e) {
							return {
								name: p.name,
								spec: p.spec,
								models: [],
								error: String((e as Error).message),
							};
						}
					}),
				);
				return new Response(JSON.stringify(results), { headers: JSON_H });
			} catch (e) {
				return new Response(
					JSON.stringify({ error: String((e as Error).message) }),
					{ status: 500, headers: JSON_H },
				);
			}
		}

		if (path === "/api/upstream-models" && req.method === "GET") {
			try {
				const baseUrl = url.searchParams.get("base_url") || "";
				const apiKey = url.searchParams.get("api_key") || "";
				if (!baseUrl)
					return new Response(JSON.stringify({ error: "base_url required" }), {
						status: 400,
						headers: JSON_H,
					});
				const headers = {};
				if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
				const r = await fetch(baseUrl.replace(/[\\/]+\$/, "") + "/models", {
					headers: headers,
					signal: AbortSignal.timeout(8000),
				});
				if (!r.ok)
					return new Response(
						JSON.stringify({ error: "upstream " + r.status }),
						{ status: 502, headers: JSON_H },
					);
				const data = await r.json();
				return new Response(JSON.stringify(data), { headers: JSON_H });
			} catch (e) {
				return new Response(
					JSON.stringify({ error: String((e as Error).message) }),
					{ status: 502, headers: JSON_H },
				);
			}
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log("GodeX Studio listening on http://127.0.0.1:" + PORT);
console.log("  -> GodeX:     " + GODEX_BASE);
console.log("  -> Trace DB:  " + TRACE_DB_PATH);
console.log("  -> Config:    " + GODEX_CONFIG);
console.log("  -> Binary:    " + GODEX_BINARY);

const HTML_PATH = resolve(import.meta.dirname ?? ".", "../public/index.html");
let _htmlCache: string | null = null;
function loadHTML(): string {
	if (_htmlCache) return _htmlCache;
	try {
		_htmlCache = fs_read(HTML_PATH, "utf-8");
		// Substitute __GODEX_BASE__ and __STUDIO_PORT__
		_htmlCache = _htmlCache
			.replace(/__GODEX_BASE__/g, GODEX_BASE)
			.replace(/__STUDIO_PORT__/g, String(PORT));
	} catch {
		_htmlCache = "<h1>Failed to load UI</h1>";
	}
	return _htmlCache;
}
