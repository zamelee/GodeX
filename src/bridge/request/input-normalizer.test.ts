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
			content: [
				{
					type: "tool_use",
					id: "call_ok",
					name: "lookup",
					input: { city: "Hangzhou" },
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
			content: [
				expect.objectContaining({
					type: "tool_use",
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
			content: [
				{
					type: "tool_use",
					id: "call_empty_args",
					name: "shell_command",
					input: {},
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
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "call_broken", content: "result" },
			],
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
			content: [
				{
					type: "tool_use",
					id: "call_paired",
					name: "lookup",
					input: { city: "Hangzhou" },
				},
			],
		});
	});

	test("drops duplicate function_call_output when matched by a single function_call", () => {
		const messages = normalizeResponseItems(
			[
				{
					type: "function_call",
					call_id: "call_dup",
					name: "lookup",
					arguments: `{"city":"Hangzhou"}`,
				} as never,
				{
					type: "function_call_output",
					call_id: "call_dup",
					output: "first result",
				} as never,
				{
					type: "function_call_output",
					call_id: "call_dup",
					output: "duplicate result",
				} as never,
			],
			request(),
		);

		// 1 assistant tool_use + 1 user tool_result (the second duplicate is dropped)
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_dup",
					name: "lookup",
					input: { city: "Hangzhou" },
				},
			],
		});
		expect(messages[1]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_dup",
					content: "first result",
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
			content: [
				{
					type: "tool_use",
					id: "call_paired",
					name: "lookup",
					input: { city: "Hangzhou" },
				},
			],
		});
		expect(messages[1]).toEqual({
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "call_paired", content: "Sunny" },
			],
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
			content: [
				{
					type: "tool_use",
					id: "call_orphan",
					name: "lookup",
					input: { city: "Hangzhou" },
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
			content: [
				{
					type: "tool_use",
					id: "call_screenshot_1",
					name: "browser.screenshot",
					input: {},
				},
			],
		});
		expect(messages[1]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_screenshot_1",
					content: "Screenshot captured",
				},
			],
		});
		expect(messages[2]).toEqual({
			role: "user",
			content: [
				{
					type: "text",
					text: "[Attached media from tool result call_screenshot_1]",
				},
				{
					type: "image",
					url: "data:image/png;base64,iVBORw0KGgo=",
					detail: "high",
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
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_text_1",
						content: "plain result",
					},
				],
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
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_str_1",
						content: "string result",
					},
				],
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
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_custom_1",
					content: "",
				},
			],
		});
		expect(messages[2]?.role).toBe("user");
		const content = messages[2]?.content;
		expect(content?.[0]).toMatchObject({ type: "text" });
		expect(content?.[1]).toMatchObject({
			type: "image",
			url: "https://example.com/img.png",
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
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_session_1",
					content: "ok",
				},
			],
		});
		expect(messages[2]?.role).toBe("user");
	});
});

describe("normalizeCurrentInput - tool media reordering for parallel tool calls", () => {
	const ctx = { provider: "minimax", supportsImageInput: true };

	test("moves image user message out of the middle of parallel tool results", () => {
		// The assistant made two parallel tool calls (view_image + shell_command).
		// The first returns an image, the second returns text. The split produces:
		//   tool(view_image) -> user(image) -> tool(shell_command)
		// MiniMax rejects tool result not immediately following the tool call, so
		// the user(image) must be hoisted to after the tool(shell_command).
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_view_1",
						name: "view_image",
						arguments: "{}",
					} as never,
					{
						type: "function_call",
						call_id: "call_shell_1",
						name: "shell_command",
						arguments: "{}",
					} as never,
					{
						type: "function_call_output",
						call_id: "call_view_1",
						output: [
							{
								type: "input_image",
								image_url: "https://example.com/shot.png",
							},
						],
					} as never,
					{
						type: "function_call_output",
						call_id: "call_shell_1",
						output: "ls\nfile.txt",
					} as never,
				],
			}),
			ctx,
		);
		// Bridge shape: 2 assistant (one tool_use each) + 2 tool_result user + 1 media user = 5
		// After reorder: tool_results stay in order, media user hoisted to the end
		expect(messages).toHaveLength(5);
		expect(messages[0]?.role).toBe("assistant");
		expect(messages[1]?.role).toBe("assistant");
		expect(messages[2]?.role).toBe("user");
		expect(messages[3]?.role).toBe("user");
		// The image user message is hoisted to position 4 with the first call's id in the prefix
		const lastContent = messages[4]?.content;
		expect(lastContent?.[0]).toMatchObject({
			type: "text",
			text: "[Attached media from tool result call_view_1]",
		});
	});

	test("hoists multiple media user messages out of a tool run", () => {
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_a",
						name: "view_image",
						arguments: "{}",
					} as never,
					{
						type: "function_call",
						call_id: "call_b",
						name: "view_image",
						arguments: "{}",
					} as never,
					{
						type: "function_call",
						call_id: "call_c",
						name: "shell_command",
						arguments: "{}",
					} as never,
					{
						type: "function_call_output",
						call_id: "call_a",
						output: [{ type: "input_image", image_url: "u1" }],
					} as never,
					{
						type: "function_call_output",
						call_id: "call_b",
						output: [{ type: "input_image", image_url: "u2" }],
					} as never,
					{
						type: "function_call_output",
						call_id: "call_c",
						output: "ok",
					} as never,
				],
			}),
			ctx,
		);
		// Bridge shape: 3 assistant (one tool_use each) + 3 tool_result user + 2 media user = 8
		// After reorder: all tool_results stay in order, all media users hoisted to the end
		expect(messages).toHaveLength(8);
		expect(messages[3]?.role).toBe("user");
		expect(messages[4]?.role).toBe("user");
		expect(messages[5]?.role).toBe("user");
		// Tool results live at positions 3,4,5 (one per call); media users hoisted to 6 and 7
		const lastContent = messages[7]?.content;
		const lastPrefix = lastContent?.[0];
		expect(lastPrefix).toMatchObject({
			type: "text",
			text: "[Attached media from tool result call_b]",
		});
		const firstMedia = messages[6]?.content?.[0];
		expect(firstMedia).toMatchObject({
			type: "text",
			text: "[Attached media from tool result call_a]",
		});
		expect(messages[7]?.role).toBe("user");
	});

	test("does not reorder a media user message when it is not between tool results", () => {
		// If the user message is not sandwiched between tool messages, leave it.
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_x",
						name: "view_image",
						arguments: "{}",
					} as never,
					{
						type: "function_call_output",
						call_id: "call_x",
						output: [{ type: "input_image", image_url: "u" }],
					} as never,
					{
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "explain" }],
					} as never,
				],
			}),
			ctx,
		);
		// assistant + tool + user(media) + user(text)
		expect(messages).toHaveLength(4);
		expect(messages[2]?.role).toBe("user");
		expect(messages[3]?.role).toBe("user");
		// Text-only content normalizes to a plain string, not a content-part array.
		expect(messages[3]?.content).toEqual([{ type: "text", text: "explain" }]);
	});

	test("keeps single-image tool output in place when no parallel tool follows", () => {
		// No parallel tool call, so the media user message stays adjacent to its tool.
		const messages = normalizeCurrentInput(
			request({
				input: [
					{
						type: "function_call",
						call_id: "call_solo",
						name: "view_image",
						arguments: "{}",
					} as never,
					{
						type: "function_call_output",
						call_id: "call_solo",
						output: [{ type: "input_image", image_url: "u" }],
					} as never,
				],
			}),
			ctx,
		);
		expect(messages).toHaveLength(3);
		expect(messages[1]?.role).toBe("user");
		expect(messages[2]?.role).toBe("user");
	});
});
