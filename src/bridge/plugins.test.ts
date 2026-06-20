import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ChatCompletionCreateRequest,
	ChatCompletionMessageParam,
	ChatCompletionUserMessageParam,
} from "../protocol/openai/completions";
import {
	applyPluginChatMessagesHooks,
	applyPluginPatchRequestHooks,
	applyPluginStreamDeltaHooks,
	type GodexPlugin,
	type GodexPluginContext,
	loadPlugins,
} from "./plugins";

const ctx: GodexPluginContext = {
	model: "minimax/MiniMax-M3",
	provider: "minimax",
};

const userMessage = (content: string): ChatCompletionUserMessageParam => ({
	role: "user",
	content,
});

describe("applyPluginChatMessagesHooks", () => {
	test("returns input unchanged when no plugins are registered", async () => {
		const messages: ChatCompletionMessageParam[] = [userMessage("hi")];
		const result = await applyPluginChatMessagesHooks([], messages, ctx);
		expect(result).toEqual(messages);
	});

	test("runs each plugin in registration order", async () => {
		const order: string[] = [];
		const plugins: GodexPlugin[] = [
			{
				name: "first",
				hooks: {
					transformChatMessages: (messages) => {
						order.push("first");
						return [...messages, userMessage("from-first")];
					},
				},
			},
			{
				name: "second",
				hooks: {
					transformChatMessages: (messages) => {
						order.push("second");
						return [...messages, userMessage("from-second")];
					},
				},
			},
		];
		const result = await applyPluginChatMessagesHooks(
			plugins,
			[userMessage("seed")],
			ctx,
		);
		expect(order).toEqual(["first", "second"]);
		expect(result.map((m) => (m.role === "user" ? m.content : ""))).toEqual([
			"seed",
			"from-first",
			"from-second",
		]);
	});

	test("awaits async plugin hooks", async () => {
		const plugins: GodexPlugin[] = [
			{
				name: "async",
				hooks: {
					transformChatMessages: async (messages) => {
						await new Promise((resolve) => setTimeout(resolve, 1));
						return [...messages, userMessage("after-await")];
					},
				},
			},
		];
		const result = await applyPluginChatMessagesHooks(
			plugins,
			[userMessage("seed")],
			ctx,
		);
		const last = result.at(-1);
		expect(last?.role).toBe("user");
		if (last?.role === "user") {
			expect(last.content).toBe("after-await");
		}
	});

	test("propagates plugin errors", async () => {
		const plugins: GodexPlugin[] = [
			{
				name: "boom",
				hooks: {
					transformChatMessages: () => {
						throw new Error("plugin failed");
					},
				},
			},
		];
		await expect(
			applyPluginChatMessagesHooks(plugins, [userMessage("hi")], ctx),
		).rejects.toThrow("plugin failed");
	});
});

describe("applyPluginPatchRequestHooks", () => {
	test("returns input unchanged when no plugins are registered", async () => {
		const request: ChatCompletionCreateRequest = {
			model: "MiniMax-M3",
			messages: [userMessage("hi")],
		};
		const result = await applyPluginPatchRequestHooks([], request, ctx);
		expect(result).toEqual(request);
	});

	test("chains patchRequest hooks in registration order", async () => {
		const plugins: GodexPlugin[] = [
			{
				name: "add-system",
				hooks: {
					patchRequest: (request) => ({
						...request,
						messages: [{ role: "system", content: "sys" }, ...request.messages],
					}),
				},
			},
			{
				name: "add-temperature",
				hooks: {
					patchRequest: (request) => ({ ...request, temperature: 0.5 }),
				},
			},
		];
		const result = await applyPluginPatchRequestHooks(
			plugins,
			{ model: "MiniMax-M3", messages: [userMessage("hi")] },
			ctx,
		);
		expect(result.messages.at(0)?.role).toBe("system");
		expect(result.temperature).toBe(0.5);
	});

	test("propagates plugin errors", async () => {
		const plugins: GodexPlugin[] = [
			{
				name: "boom",
				hooks: {
					patchRequest: () => {
						throw new Error("patch failed");
					},
				},
			},
		];
		await expect(
			applyPluginPatchRequestHooks(
				plugins,
				{ model: "MiniMax-M3", messages: [] },
				ctx,
			),
		).rejects.toThrow("patch failed");
	});
});

describe("applyPluginStreamDeltaHooks", () => {
	test("returns input unchanged when no plugins are registered", async () => {
		const delta = { choices: [{ delta: { content: "hi" } }] };
		const result = await applyPluginStreamDeltaHooks([], delta, ctx);
		expect(result).toEqual(delta);
	});

	test("chains transformStreamDelta hooks in registration order", async () => {
		const plugins: GodexPlugin[] = [
			{
				name: "strip-tool-calls",
				hooks: {
					transformStreamDelta: (delta) => {
						const d = delta as {
							choices?: Array<{ delta?: { tool_calls?: unknown[] } }>;
						};
						if (d.choices?.[0]?.delta?.tool_calls) {
							return {
								...d,
								choices: d.choices.map((c) => ({
									...c,
									delta: { ...c.delta, tool_calls: [] },
								})),
							};
						}
						return delta;
					},
				},
			},
		];
		const delta = { choices: [{ delta: { tool_calls: [{ id: "x" }] } }] };
		const result = (await applyPluginStreamDeltaHooks(plugins, delta, ctx)) as {
			choices: Array<{ delta: { tool_calls: unknown[] } }>;
		};
		expect(result.choices[0]?.delta.tool_calls).toEqual([]);
	});

	test("propagates plugin errors", async () => {
		const plugins: GodexPlugin[] = [
			{
				name: "boom",
				hooks: {
					transformStreamDelta: () => {
						throw new Error("stream failed");
					},
				},
			},
		];
		await expect(applyPluginStreamDeltaHooks(plugins, {}, ctx)).rejects.toThrow(
			"stream failed",
		);
	});
});

describe("loadPlugins", () => {
	let dir: string;
	let previousCwd: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "godex-plugins-"));
		previousCwd = process.cwd();
		process.chdir(dir);
	});
	afterEach(() => {
		process.chdir(previousCwd);
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns an empty list for an empty path list", async () => {
		const plugins = await loadPlugins([]);
		expect(plugins).toEqual([]);
	});

	test("imports a plugin file that exports a default GodexPlugin", async () => {
		const pluginPath = join(dir, "test-plugin.mjs");
		writeFileSync(
			pluginPath,
			`export default {
	name: "test",
	hooks: {
		transformChatMessages: (messages) => messages,
	},
};`,
		);
		const plugins = await loadPlugins([pluginPath]);
		expect(plugins).toHaveLength(1);
		expect(plugins[0]?.name).toBe("test");
		expect(plugins[0]?.hooks.transformChatMessages).toBeInstanceOf(Function);
	});

	test("imports a plugin file that uses a named plugin export when default is absent", async () => {
		const pluginPath = join(dir, "named-plugin.mjs");
		writeFileSync(
			pluginPath,
			`export const plugin = {
	name: "named",
	hooks: {},
};`,
		);
		const plugins = await loadPlugins([pluginPath]);
		expect(plugins).toHaveLength(1);
		expect(plugins[0]?.name).toBe("named");
	});

	test("rejects plugins missing the name field", async () => {
		const pluginPath = join(dir, "bad-plugin.mjs");
		writeFileSync(pluginPath, `export default { hooks: {} };`);
		await expect(loadPlugins([pluginPath])).rejects.toThrow(
			/did not export a GodexPlugin/,
		);
	});

	test("rejects plugins missing the hooks field", async () => {
		const pluginPath = join(dir, "no-hooks.mjs");
		writeFileSync(pluginPath, `export default { name: "no-hooks" };`);
		await expect(loadPlugins([pluginPath])).rejects.toThrow(
			/did not export a GodexPlugin/,
		);
	});
});
