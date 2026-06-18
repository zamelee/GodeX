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

	test("coerces empty arguments to an empty object literal", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_empty_args",
						name: "shell_command",
						arguments: "",
					} as never,
				],
			}),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_empty_args",
					type: "function",
					function: { name: "shell_command", arguments: "{}" },
				},
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

describe("normalizeCurrentInput - tool output media splitting", () => {
	test("function_call_output with image parts splits into tool + user messages", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_screenshot_1",
						name: "browser.screenshot",
						arguments: "{}",
					} as never,
					{
						type: "function_call_output",
						call_id: "call_screenshot_1",
						output: [
							{ type: "input_text", text: "Screenshot captured" },
							{
								type: "input_image",
								image_url: "data:image/png;base64,iVBORw0KGgo=",
								detail: "high",
							},
						],
					} as never,
				],
			}),
			{ provider: "minimax", supportsImageInput: true },
		);
		expect(messages).toHaveLength(3);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			tool_calls: [{ id: "call_screenshot_1" }],
		});
		expect(messages[1]).toEqual({
			role: "tool",
			tool_call_id: "call_screenshot_1",
			content: "Screenshot captured",
		});
		expect(messages[2]).toEqual({
			role: "user",
			content: [
				{
					type: "text",
					text: "[Attached media from tool result call_screenshot_1]",
				},
				{
					type: "image_url",
					image_url: {
						url: "data:image/png;base64,iVBORw0KGgo=",
						detail: "high",
					},
				},
			],
		});
	});

	test("function_call_output with only text stays as a single tool message", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call_output",
						call_id: "call_text_1",
						output: [{ type: "input_text", text: "plain result" }],
					} as never,
				],
			}),
		);
		expect(messages).toEqual([
			{
				role: "tool",
				tool_call_id: "call_text_1",
				content: "plain result",
			},
		]);
	});

	test("function_call_output string content stays as a single tool message", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call_output",
						call_id: "call_str_1",
						output: "string result",
					} as never,
				],
			}),
		);
		expect(messages).toEqual([
			{
				role: "tool",
				tool_call_id: "call_str_1",
				content: "string result",
			},
		]);
	});

	test("custom_tool_call_output with image parts splits into tool + user messages", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "custom_tool_call",
						call_id: "call_custom_1",
						name: "render",
						input: "{}",
					} as never,
					{
						type: "custom_tool_call_output",
						call_id: "call_custom_1",
						output: [
							{
								type: "input_image",
								image_url: "https://example.com/img.png",
							},
						],
					} as never,
				],
			}),
			{ provider: "minimax", supportsImageInput: true },
		);
		expect(messages).toHaveLength(3);
		expect(messages[1]).toEqual({
			role: "tool",
			tool_call_id: "call_custom_1",
			content: "",
		});
		expect(messages[2]?.role).toBe("user");
		const content = messages[2]?.content as Array<{ type: string }>;
		expect(content[0]).toMatchObject({ type: "text" });
		expect(content[1]).toMatchObject({
			type: "image_url",
			image_url: { url: "https://example.com/img.png" },
		});
	});

	test("normalizeResponseItems passes images from session tool outputs through to a user message", () => {
		const messages = normalizeResponseItems(
			[
				{
					type: "function_call",
					call_id: "call_session_1",
					name: "browser.screenshot",
					arguments: "{}",
				},
				{
					type: "function_call_output",
					call_id: "call_session_1",
					output: [
						{ type: "input_text", text: "ok" },
						{
							type: "input_image",
							image_url: "https://example.com/s.png",
						},
					],
				},
			] as never,
			request({ input: undefined }),
			{ provider: "minimax", supportsImageInput: true },
		);
		expect(messages).toHaveLength(3);
		expect(messages[1]).toEqual({
			role: "tool",
			tool_call_id: "call_session_1",
			content: "ok",
		});
		expect(messages[2]?.role).toBe("user");
	});
});
