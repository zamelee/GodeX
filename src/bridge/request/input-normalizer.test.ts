import { describe, expect, test } from "bun:test";
import type { ResponseCreateRequest } from "../../protocol/openai/responses";
import {
	normalizeCurrentInput,
	normalizeResponseItems,
} from "./input-normalizer";

function request(
	overrides: Partial<ResponseCreateRequest> = {},
): ResponseCreateRequest {
	return {
		model: "minimax/MiniMax-M3",
		input: [],
		...overrides,
	} as ResponseCreateRequest;
}

describe("normalizeCurrentInput - tool call argument sanitization", () => {
	test("drops function_call with invalid JSON arguments", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_broken",
						name: "lookup",
						arguments: "{not-json",
					} as never,
				],
			}),
		);

		expect(messages).toEqual([]);
	});

	test("keeps function_call with valid JSON arguments", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_ok",
						name: "lookup",
						arguments: `{"city":"Hangzhou"}`,
					} as never,
				],
			}),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_ok",
					type: "function",
					function: { name: "lookup", arguments: `{"city":"Hangzhou"}` },
				},
			],
		});
	});

	test("drops shell_call with invalid JSON arguments", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "shell_call",
						call_id: "call_shell",
						action: undefined,
					} as never,
				],
			}),
		);

		expect(messages).toEqual([]);
	});

	test("keeps shell_call with valid JSON arguments", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "shell_call",
						call_id: "call_shell_ok",
						action: { commands: ["bun test"] },
					} as never,
				],
			}),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe("assistant");
	});

	test("keeps custom_tool_call with valid synthesized arguments", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "custom_tool_call",
						call_id: "call_custom_ok",
						name: "search",
						input: "src/index.ts",
					} as never,
				],
			}),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [
				expect.objectContaining({
					id: "call_custom_ok",
				}),
			],
		});
	});

	test("preserves function_call output when its function_call was dropped", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_broken",
						name: "lookup",
						arguments: "{not-json",
					} as never,
					{
						type: "function_call_output",
						call_id: "call_broken",
						output: "result",
					} as never,
				],
			}),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toEqual({
			role: "tool",
			tool_call_id: "call_broken",
			content: "result",
		});
	});
});

describe("normalizeResponseItems - session history pairing", () => {
	test("drops function_call_output with no matching function_call", () => {
		const messages = normalizeResponseItems(
			[
				{
					type: "function_call",
					call_id: "call_paired",
					name: "lookup",
					arguments: `{"city":"Hangzhou"}`,
				} as never,
				{
					type: "function_call_output",
					call_id: "call_orphan",
					output: "orphan",
				} as never,
			],
			request(),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_paired",
					function: { name: "lookup", arguments: `{"city":"Hangzhou"}` },
				},
			],
		});
	});

	test("keeps function_call_output when matched by an earlier function_call", () => {
		const messages = normalizeResponseItems(
			[
				{
					type: "function_call",
					call_id: "call_paired",
					name: "lookup",
					arguments: `{"city":"Hangzhou"}`,
				} as never,
				{
					type: "function_call_output",
					call_id: "call_paired",
					output: "Sunny",
				} as never,
			],
			request(),
		);

		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_paired",
					function: { name: "lookup", arguments: `{"city":"Hangzhou"}` },
				},
			],
		});
		expect(messages[1]).toEqual({
			role: "tool",
			tool_call_id: "call_paired",
			content: "Sunny",
		});
	});

	test("keeps unpaired function_call so Codex can resume the conversation", () => {
		const messages = normalizeResponseItems(
			[
				{
					type: "function_call",
					call_id: "call_orphan",
					name: "lookup",
					arguments: `{"city":"Hangzhou"}`,
				} as never,
			],
			request(),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_orphan",
					function: { name: "lookup", arguments: `{"city":"Hangzhou"}` },
				},
			],
		});
	});

	test("drops orphan shell_call_output and local_shell_call_output", () => {
		const messages = normalizeResponseItems(
			[
				{
					type: "shell_call_output",
					call_id: "shell_orphan",
					output: [
						{
							outcome: { type: "exit", exit_code: 0 },
							stdout: "ok",
							stderr: "",
						},
					],
				} as never,
				{
					type: "local_shell_call_output",
					call_id: "local_orphan",
					output: "/repo",
				} as never,
			],
			request(),
		);

		expect(messages).toEqual([]);
	});
});
