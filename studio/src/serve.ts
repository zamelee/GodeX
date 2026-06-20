// GodeX Studio — Layer 4 UI Server

import {
	existsSync,
	readFileSync as fs_read,
	writeFileSync as fs_write,
} from "node:fs";
import { resolve } from "node:path";
import {
	killGodex,
	startGodex,
	pushLog,
	getRecentLogs,
	subscribe,
	isGodexRunning,
	getGodexPid,
	getGodexConfig,
	getGodexBinary,
} from "./log-stream";

const GODEX_BASE = process.env.GODEX_BASE ?? "http://127.0.0.1:5678";
const PORT = Number(process.env.STUDIO_PORT ?? "56791");
const GODEX_CONFIG = getGodexConfig();
const GODEX_BINARY = getGodexBinary();

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};
const JSON_H = { "Content-Type": "application/json", ...CORS };
const HTML_H = { "Content-Type": "text/html; charset=utf-8", ...CORS };

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

interface EnabledModelYaml {
	provider: string;
	model: string;
	context_window?: number;
	max_tokens?: number;
	multimodal?: boolean;
	capabilities?: Record<string, boolean>;
	note?: string;
}

function readAllProviders(): Array<{ name: string; spec: string; base_url: string; api_key: string; timeout_ms: number; }> {
	const out: Array<{ name: string; spec: string; base_url: string; api_key: string; timeout_ms: number; }> = [];
	if (!existsSync(GODEX_CONFIG)) return out;
	try {
		const raw = fs_read(GODEX_CONFIG, "utf-8");
		const pm = raw.match(/providers:\s*\n([\s\S]*?)(?:\n[a-zA-Z]|$)/);
		if (!pm || !pm[1]) return out;
		const body = pm[1];
		const blocks = body.split(/\n(?= {2}[A-Za-z0-9_.\-/]+:\s*\n)/);
		for (const block of blocks) {
			const nm = block.match(/^ {2}([A-Za-z0-9_.\-/]+):\s*\n/);
			if (!nm || !nm[1]) continue;
			const name = nm[1];
			const specM = block.match(/spec:\s*(\S+)/);
			const baseM = block.match(/base_url:\s*(\S+)/);
			const timeoutM = block.match(/timeout_ms:\s*(\d+)/);
			const apiKeyM = block.match(/api_key:\s*(\S+)/);
			out.push({
				name,
				spec: specM && specM[1] ? specM[1] : name,
				base_url: baseM && baseM[1] ? baseM[1] : "",
				timeout_ms: timeoutM && timeoutM[1] ? parseInt(timeoutM[1], 10) : 120000,
				api_key: apiKeyM && apiKeyM[1] ? apiKeyM[1] : "",
			});
		}
	} catch {}
	return out;
}

function upsertProvider(name: string, baseUrl: string, apiKey: string, timeoutMs: number, spec: string): void {
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
			"  enabled: []",
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
		"  " + name + ":\n" +
		"    spec: " + (spec || name) + "\n" +
		"    credentials:\n" +
		"      api_key: " + (apiKey || "") + "\n" +
		"    endpoint:\n" +
		"      base_url: " + (baseUrl || "https://api.example.com/v1") + "\n" +
		"    timeout_ms: " + (timeoutMs || 120000) + "\n";

	const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		"( {2}" + nameEsc + ":\n[\\s\\S]*?)(?=\\n {2}[^\\s]|\\n[a-zA-Z]|\\Z)",
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

function yamlValue(v: unknown): string {
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	return JSON.stringify(v);
}

function enabledToYaml(items: EnabledModelYaml[]): string {
	if (!items.length) return "  enabled: []\n";
	const lines = ["  enabled:"];
	for (const it of items) {
		lines.push("    - provider: " + it.provider);
		lines.push("      model: " + it.model);
		if (it.context_window !== undefined) lines.push("      context_window: " + it.context_window);
		if (it.max_tokens !== undefined) lines.push("      max_tokens: " + it.max_tokens);
		if (it.multimodal !== undefined) lines.push("      multimodal: " + (it.multimodal ? "true" : "false"));
		if (it.capabilities) {
			const cap = it.capabilities;
			const keys = Object.keys(cap);
			if (keys.length > 0) {
				lines.push("      capabilities:");
				for (const k of keys) {
					lines.push("        " + k + ": " + (cap[k] ? "true" : "false"));
				}
			}
		}
		if (it.note !== undefined && it.note !== "") lines.push("      note: " + JSON.stringify(it.note));
	}
	return lines.join("\n") + "\n";
}

function writeEnabledModels(items: EnabledModelYaml[]): void {
	let raw = existsSync(GODEX_CONFIG) ? fs_read(GODEX_CONFIG, "utf-8") : "";
	const enabledYaml = enabledToYaml(items);
	if (/models:\s*\n {2}enabled:/.test(raw)) {
		raw = raw.replace(/models:\s*\n {2}enabled:[\s\S]*?(?=\n[a-zA-Z]|\Z)/, enabledYaml.trimEnd());
	} else if (/models:[\s\S]*?\n {2}aliases:/.test(raw)) {
		raw = raw.replace(/models:([\s\S]*?\n {2}aliases:[\s\S]*?)(?=\n[a-zA-Z]|\Z)/, function(_m, mid) {
			return "models:\n" + enabledYaml + mid.replace(/^\n+/, "");
		});
	} else if (/models:/.test(raw)) {
		raw = raw.replace(/models:[\s\S]*?(?=\n[a-zA-Z]|\Z)/, function(_m) {
			return "models:\n" + enabledYaml;
		});
	} else {
		raw = raw.replace(/^(default_provider:[\s\S]*?\n)/, "$1models:\n" + enabledYaml);
	}
	fs_write(GODEX_CONFIG, raw, "utf-8");
}

function readEnabledModels(): EnabledModelYaml[] {
	if (!existsSync(GODEX_CONFIG)) return [];
	try {
		const raw = fs_read(GODEX_CONFIG, "utf-8");
		const m = raw.match(/models:\s*\n {2}enabled:([\s\S]*?)(?=\n[a-zA-Z]|\Z)/);
		if (!m || !m[1]) return [];
		const body = m[1];
		const out: EnabledModelYaml[] = [];
		const itemRe = / {4}-\s+provider:\s*(\S+)\s*\n {6}model:\s*(\S+)([\s\S]*?)(?=\n {4}-|\Z)/g;
		let im: RegExpExecArray | null;
		while ((im = itemRe.exec(body)) !== null) {
			if (!im[1] || !im[2]) continue;
			const provider = im[1];
			const model = im[2];
			const tail = im[3] || "";
			const item: EnabledModelYaml = { provider, model };
			const cwM = tail.match(/context_window:\s*(\d+)/);
			if (cwM && cwM[1]) item.context_window = parseInt(cwM[1], 10);
			const mtM = tail.match(/max_tokens:\s*(\d+)/);
			if (mtM && mtM[1]) item.max_tokens = parseInt(mtM[1], 10);
			const mmM = tail.match(/multimodal:\s*(true|false)/);
			if (mmM && mmM[1]) item.multimodal = mmM[1] === "true";
			const capM = tail.match(/capabilities:\s*\n([\s\S]*?)(?=\n {4,6}[a-z]|\n {4}-|\Z)/);
			if (capM && capM[1]) {
				const cap: Record<string, boolean> = {};
				for (const cm of capM[1].matchAll(/ {8}([a-z_]+):\s*(true|false)/g)) {
					if (cm[1]) cap[cm[1]] = cm[2] === "true";
				}
				if (Object.keys(cap).length > 0) item.capabilities = cap;
			}
			const noteM = tail.match(/note:\s*("[^"]*"|\S+)/);
			if (noteM && noteM[1]) item.note = noteM[1].replace(/^"|"$/g, "");
			out.push(item);
		}
		return out;
	} catch {
		return [];
	}
}

// Restart godex by killing any listener on its port and spawning a fresh child.
// Both steps are delegated to ./log-stream so log capture stays consistent.
function restartGodexProcess(): { ok: boolean; pid?: number; error?: string } {
	killGodex();
	const result = startGodex();
	if (!result.ok) {
		return { ok: false, error: result.error };
	}
	return { ok: true, pid: result.pid };
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
		// GET /api/logs - recent lines from the in-memory ring buffer (godex + studio).
		if (path === "/api/logs" && req.method === "GET") {
			const limitRaw = url.searchParams.get("limit");
			const limit = limitRaw ? Math.min(2000, Math.max(1, Number(limitRaw))) : 200;
			return new Response(JSON.stringify(getRecentLogs(limit)), { headers: JSON_H });
		}

		// GET /api/logs/stream - Server-Sent Events stream from the ring buffer.
		// Replays the existing buffer first, then pushes live lines.
		if (path === "/api/logs/stream" && req.method === "GET") {
			const encoder = new TextEncoder();
			let unsubscribe: (() => void) | null = null;
			const stream = new ReadableStream({
				start(controller) {
					const send = (event: string, payload: unknown): void => {
						try {
							controller.enqueue(
								encoder.encode("event: " + event + "\ndata: " + JSON.stringify(payload) + "\n\n"),
							);
						} catch {}
					};
					send("ready", { ts: Date.now() });
					for (const line of getRecentLogs(200)) send("line", line);
					unsubscribe = subscribe((line) => send("line", line));
				},
				cancel() {
					if (unsubscribe) {
						try { unsubscribe(); } catch {}
						unsubscribe = null;
					}
				},
			});
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					...CORS,
				},
			});
		}

		// GET /api/status - godex health + process info + config presence
		if (path === "/api/status" && req.method === "GET") {
			let health: unknown = null;
			try {
				const r = await fetch(GODEX_BASE + "/health", { signal: AbortSignal.timeout(3000) });
				health = { status: r.status, body: await r.text() };
			} catch (e) {
				health = { error: String((e as Error).message) };
			}
			return new Response(
				JSON.stringify({
					godex_base: GODEX_BASE,
					godex_health: health,
					running: isGodexRunning(),
					pid: getGodexPid(),
					binary: getGodexBinary(),
					config: getGodexConfig(),
				}),
				{ headers: JSON_H },
			);
		}

		// POST /api/save-config - persist `models.enabled[]` only; never restarts godex.
		if (path === "/api/save-config" && req.method === "POST") {
			try {
				const body = (await req.json()) as { enabled?: EnabledModelYaml[] };
				if (!Array.isArray(body.enabled)) {
					return new Response(
						JSON.stringify({ ok: false, error: "enabled[] required" }),
						{ status: 400, headers: JSON_H },
					);
				}
				writeEnabledModels(body.enabled);
				pushLog("[studio] saved models.enabled[] (" + body.enabled.length + " items)", "studio", "info");
				return new Response(JSON.stringify({ ok: true, count: body.enabled.length }), { headers: JSON_H });
			} catch (e: unknown) {
				return new Response(
					JSON.stringify({ ok: false, error: (e as Error).message }),
					{ status: 400, headers: JSON_H },
				);
			}
		}

		// POST /api/restart - kill + spawn godex; godex streams its own stdout into /api/logs/stream
		if (path === "/api/restart" && req.method === "POST") {
			const r = restartGodexProcess();
			if (!r.ok) {
				return new Response(JSON.stringify({ ok: false, error: r.error }), { status: 500, headers: JSON_H });
			}
			return new Response(JSON.stringify({ ok: true, pid: r.pid }), { headers: JSON_H });
		}

		// GET /api/enabled-models - reflect what godex parsed (so Studio can sync current state)
		if (path === "/api/enabled-models" && req.method === "GET") {
			try {
				const r = await fetch(GODEX_BASE + "/admin/enabled-models", {
					signal: AbortSignal.timeout(5000),
				});
				return new Response(await r.text(), {
					status: r.status,
					headers: JSON_H,
				});
			} catch (e: unknown) {
				return new Response(
					JSON.stringify({ error: String((e as Error).message) }),
					{ status: 502, headers: JSON_H },
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
				const body = (await req.json()) as { name?: string; base_url?: string; api_key?: string; spec?: string; timeout_ms?: number };
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
				const headers: Record<string, string> = {};
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
console.log("  -> Config:    " + GODEX_CONFIG);
console.log("  -> Binary:    " + GODEX_BINARY);

// Locate public/index.html relative to the running executable (or source in dev).
function locateHtmlPath(): string {
	const candidates: string[] = [];
	if (process.execPath) candidates.push(resolve(process.execPath, "..", "public", "index.html"));
	if (process.argv[1]) candidates.push(resolve(process.argv[1], "..", "..", "public", "index.html"));
	if (import.meta.dirname) candidates.push(resolve(import.meta.dirname, "../public/index.html"));
	candidates.push(resolve(process.cwd(), "studio", "public", "index.html"));
	candidates.push(resolve(process.cwd(), "public", "index.html"));
	for (const p of candidates) {
		try { if (existsSync(p)) return p; } catch {}
	}
	return candidates.find((p): p is string => typeof p === "string") ?? resolve(process.cwd(), "public", "index.html");
}
const HTML_PATH = locateHtmlPath();
let _htmlCache: string | undefined;
function loadHTML(): string {
	if (_htmlCache !== undefined) return _htmlCache;
	try {
		_htmlCache = fs_read(HTML_PATH, "utf-8");
		_htmlCache = _htmlCache
			.replace(/__GODEX_BASE__/g, GODEX_BASE)
			.replace(/__STUDIO_PORT__/g, String(PORT));
	} catch (e) {
		_htmlCache = "<h1>Failed to load UI from " + HTML_PATH + ": " + String((e as Error).message) + "</h1>";
	}
	return _htmlCache;
}
