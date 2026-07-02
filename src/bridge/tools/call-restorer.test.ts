import { describe, expect, test } from "bun:test";
import { restoreToolCall } from "./call-restorer";
import { ToolIdentityMap } from "./tool-identity";

describe("restoreToolCall", () => {
	test("restores downgraded local_shell provider calls", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "local_shell",
			providerName: "local_shell",
			requestedType: "local_shell",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_local_shell",
				name: "local_shell",
				arguments: JSON.stringify({
					cmd: ["bun", "test"],
					env: { CI: "true", ignored: 1 },
				}),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_local_shell",
			type: "local_shell_call",
			call_id: "call_local_shell",
			status: "in_progress",
			action: {
				type: "exec",
				command: ["bun", "test"],
				env: { CI: "true" },
			},
		});
	});

	test("falls back to function_call for unknown provider calls", () => {
		const item = restoreToolCall(
			{
				callId: "call_lookup",
				name: "lookup",
				arguments: '{"city":"Hangzhou"}',
			},
			new ToolIdentityMap(),
		);

		expect(item).toEqual({
			type: "function_call",
			call_id: "call_lookup",
			name: "lookup",
			arguments: '{"city":"Hangzhou"}',
		});
	});

	test("restores downgraded custom provider calls", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "read-file",
			providerName: "read-file",
			requestedType: "custom",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_custom",
				name: "read-file",
				arguments: JSON.stringify({ input: "src/index.ts" }),
			},
			identities,
		);

		expect(item).toEqual({
			type: "custom_tool_call",
			call_id: "call_custom",
			name: "read-file",
			input: "src/index.ts",
		});
	});

	test("falls back to function_call for invalid local_shell arguments", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "local_shell",
			providerName: "local_shell",
			requestedType: "local_shell",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_local_shell",
				name: "local_shell",
				arguments: "bun test",
			},
			identities,
		);

		expect(item).toEqual({
			type: "function_call",
			call_id: "call_local_shell",
			name: "local_shell",
			arguments: "bun test",
		});
	});

	test("preserves shell action fields", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "shell",
			providerName: "shell",
			requestedType: "shell",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_shell",
				name: "shell",
				arguments: JSON.stringify({
					commands: ["bun test"],
					timeout_ms: 1000,
					max_output_length: 4096,
				}),
			},
			identities,
		);

		expect(item).toEqual({
			type: "shell_call",
			call_id: "call_shell",
			status: "in_progress",
			action: {
				commands: ["bun test"],
				timeout_ms: 1000,
				max_output_length: 4096,
			},
		});
	});

	test("restores valid apply_patch calls", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "apply_patch",
			providerName: "apply_patch",
			requestedType: "apply_patch",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_patch",
				name: "apply_patch",
				arguments: JSON.stringify({
					operation: {
						type: "delete_file",
						path: "tmp.txt",
					},
				}),
			},
			identities,
		);

		expect(item).toEqual({
			type: "apply_patch_call",
			call_id: "call_patch",
			status: "in_progress",
			operation: {
				type: "delete_file",
				path: "tmp.txt",
			},
		});
	});

	test("restores apply_patch update operations with diff payloads", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "apply_patch",
			providerName: "apply_patch",
			requestedType: "apply_patch",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_patch",
				name: "apply_patch",
				arguments: JSON.stringify({
					operation: {
						type: "update_file",
						path: "src/index.ts",
						diff: "@@ patch",
					},
				}),
			},
			identities,
		);

		expect(item).toEqual({
			type: "apply_patch_call",
			call_id: "call_patch",
			status: "in_progress",
			operation: {
				type: "update_file",
				path: "src/index.ts",
				diff: "@@ patch",
			},
		});
	});

	test("restores tool_search as a client-executed tool_search_call", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "tool_search",
			providerName: "tool_search",
			requestedType: "tool_search",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_tool_search",
				name: "tool_search",
				arguments: JSON.stringify({ query: "available tools", limit: 5 }),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_tool_search",
			type: "tool_search_call",
			call_id: "call_tool_search",
			arguments: { query: "available tools", limit: 5 },
			execution: "client",
			status: "in_progress",
		});
	});

	test("preserves raw tool_search arguments when JSON is invalid", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "tool_search",
			providerName: "tool_search",
			requestedType: "tool_search",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_tool_search_raw",
				name: "tool_search",
				arguments: "not json",
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_tool_search_raw",
			type: "tool_search_call",
			call_id: "call_tool_search_raw",
			arguments: "not json",
			execution: "client",
			status: "in_progress",
		});
	});

	test("restores computer_use screenshot actions", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "computer_use",
			providerName: "computer_use",
			requestedType: "computer_use",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_screen",
				name: "computer_use",
				arguments: JSON.stringify({ action: "screenshot" }),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_screen",
			type: "computer_call",
			call_id: "call_screen",
			pending_safety_checks: [],
			status: "in_progress",
			action: { type: "screenshot" },
		});
	});

	test("restores computer_use click actions with normalized button", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "computer_use",
			providerName: "computer_use",
			requestedType: "computer_use",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_click",
				name: "computer_use",
				arguments: JSON.stringify({
					action: "click",
					x: 100,
					y: 200,
					button: "right",
				}),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_click",
			type: "computer_call",
			call_id: "call_click",
			pending_safety_checks: [],
			status: "in_progress",
			action: {
				type: "click",
				x: 100,
				y: 200,
				button: "right",
			},
		});
	});

	test("falls back to function_call for computer_use missing action field", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "computer_use",
			providerName: "computer_use",
			requestedType: "computer_use",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_bad",
				name: "computer_use",
				arguments: JSON.stringify({ x: 1, y: 2 }),
			},
			identities,
		);

		expect(item).toEqual({
			type: "function_call",
			call_id: "call_bad",
			name: "computer_use",
			arguments: JSON.stringify({ x: 1, y: 2 }),
		});
	});

	test("restores computer_use type actions with text payload", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "computer_use",
			providerName: "computer_use",
			requestedType: "computer_use",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_type",
				name: "computer_use",
				arguments: JSON.stringify({ action: "type", text: "hello" }),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_type",
			type: "computer_call",
			call_id: "call_type",
			pending_safety_checks: [],
			status: "in_progress",
			action: { type: "type", text: "hello" },
		});
	});

	test("restores computer_use drag actions with point paths", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "computer_use",
			providerName: "computer_use",
			requestedType: "computer_use",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_drag",
				name: "computer_use",
				arguments: JSON.stringify({
					action: "drag",
					path: [
						{ x: 10, y: 20 },
						{ x: 30, y: 40 },
					],
				}),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_drag",
			type: "computer_call",
			call_id: "call_drag",
			pending_safety_checks: [],
			status: "in_progress",
			action: {
				type: "drag",
				path: [
					{ x: 10, y: 20 },
					{ x: 30, y: 40 },
				],
			},
		});
	});

	test("treats computer as an alias of computer_use", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "computer",
			providerName: "computer",
			requestedType: "computer",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_wait",
				name: "computer",
				arguments: JSON.stringify({ action: "wait" }),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_wait",
			type: "computer_call",
			call_id: "call_wait",
			pending_safety_checks: [],
			status: "in_progress",
			action: { type: "wait" },
		});
	});

	test("restores web_search as web_search_call", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "web_search",
			providerName: "web_search",
			requestedType: "web_search",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_web_search",
				name: "web_search",
				arguments: JSON.stringify({ query: "top AI news" }),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_web_search",
			type: "web_search_call",
			action: { type: "search", query: "top AI news" },
			status: "in_progress",
		});
	});

	test("falls back to function_call for web_search without query field", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "web_search",
			providerName: "web_search",
			requestedType: "web_search",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_web_bad",
				name: "web_search",
				arguments: JSON.stringify({ url: "https://example.com" }),
			},
			identities,
		);

		expect(item).toEqual({
			type: "function_call",
			call_id: "call_web_bad",
			name: "web_search",
			arguments: JSON.stringify({ url: "https://example.com" }),
		});
	});

	test("restores web_search even when upstream suffixes the name", () => {
		const identities = new ToolIdentityMap();
		identities.add({
			requestedName: "web_search",
			providerName: "web_search_0",
			requestedType: "web_search",
			providerType: "function",
		});

		const item = restoreToolCall(
			{
				callId: "call_web_suffix",
				name: "web_search_0",
				arguments: JSON.stringify({ query: "weather today" }),
			},
			identities,
		);

		expect(item).toEqual({
			id: "call_web_suffix",
			type: "web_search_call",
			action: { type: "search", query: "weather today" },
			status: "in_progress",
		});
	});
});
