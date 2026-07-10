import { describe, expect, test } from "bun:test";
import {
	anthropicFinishReason,
	anthropicFirstChoice,
	anthropicOutputText,
	anthropicReasoningText,
	anthropicResponseUsage,
} from "./accessors";
import type { AnthropicMessagesResponse } from "./protocol";

function makeResp(
	overrides: Partial<AnthropicMessagesResponse> = {},
): AnthropicMessagesResponse {
	return {
		id: "msg_test",
		type: "message",
		role: "assistant",
		model: "claude-3-5-sonnet-20241022",
		content: [],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: { input_tokens: 10, output_tokens: 5 },
		...overrides,
	};
}

describe("Anthropic response accessors (Phase B4)", () => {
	describe("anthropicFirstChoice", () => {
		test("returns undefined when content is empty", () => {
			expect(anthropicFirstChoice(makeResp({ content: [] }))).toBeUndefined();
		});

		test("returns undefined when content is missing", () => {
			// Non-conforming upstream shape: missing content. Accessor must not crash.
			expect(
				anthropicFirstChoice({
					...makeResp(),
					content: undefined as unknown as AnthropicMessagesResponse["content"],
				}),
			).toBeUndefined();
		});

		test("returns synthetic firstChoice with empty tool_calls for text-only response", () => {
			const resp = makeResp({
				content: [{ type: "text", text: "hello" } as never],
			});
			const fc = anthropicFirstChoice(resp);
			expect(fc).toEqual({ message: { tool_calls: [] } });
		});

		test("synthesizes tool_calls array from tool_use blocks", () => {
			const resp = makeResp({
				content: [
					{
						type: "tool_use",
						id: "toolu_01",
						name: "get_weather",
						input: { city: "Tokyo" },
					},
					{
						type: "tool_use",
						id: "toolu_02",
						name: "search_web",
						input: { query: "weather" },
					},
				],
				stop_reason: "tool_use",
			});
			const fc = anthropicFirstChoice(resp);
			expect(fc?.message.tool_calls).toEqual([
				{
					id: "toolu_01",
					type: "function",
					function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
				},
				{
					id: "toolu_02",
					type: "function",
					function: { name: "search_web", arguments: '{"query":"weather"}' },
				},
			]);
		});

		test("string input passes through without double-encoding", () => {
			// Some upstream shims may emit tool_use.input as a stringified JSON. Pass through.
			const resp = makeResp({
				content: [
					{
						type: "tool_use",
						id: "x",
						name: "f",
						input: '{"a":1}' as unknown as Record<string, unknown>,
					},
				],
				stop_reason: "tool_use",
			});
			const fc = anthropicFirstChoice(resp);
			expect(fc?.message.tool_calls[0]?.function.arguments).toBe('{"a":1}');
		});

		test("null/undefined input serializes to empty object", () => {
			const resp = makeResp({
				content: [
					{
						type: "tool_use",
						id: "x",
						name: "f",
						input: undefined as unknown as Record<string, unknown>,
					},
				],
			});
			const fc = anthropicFirstChoice(resp);
			expect(fc?.message.tool_calls[0]?.function.arguments).toBe("{}");
		});

		test("mixed text + tool_use yields empty outputText and synthesized tool_calls", () => {
			const resp = makeResp({
				content: [
					{ type: "text", text: "checking..." },
					{ type: "tool_use", id: "t1", name: "lookup", input: { k: "v" } },
				],
				stop_reason: "tool_use",
			});
			expect(anthropicOutputText(resp)).toBe("checking...");
			const fc = anthropicFirstChoice(resp);
			expect(fc?.message.tool_calls).toHaveLength(1);
		});
	});

	describe("anthropicFinishReason", () => {
		test("translates end_turn to stop", () => {
			expect(anthropicFinishReason(makeResp({ stop_reason: "end_turn" }))).toBe(
				"stop",
			);
		});
		test("translates tool_use to tool_calls", () => {
			expect(anthropicFinishReason(makeResp({ stop_reason: "tool_use" }))).toBe(
				"tool_calls",
			);
		});
		test("translates max_tokens to length", () => {
			expect(
				anthropicFinishReason(makeResp({ stop_reason: "max_tokens" })),
			).toBe("length");
		});
		test("translates stop_sequence to stop", () => {
			expect(
				anthropicFinishReason(makeResp({ stop_reason: "stop_sequence" })),
			).toBe("stop");
		});
		test("null stop_reason passes through as undefined", () => {
			// Bridge contract: undefined when absent so mapProviderFinishReason can detect failed state.
			expect(
				anthropicFinishReason(makeResp({ stop_reason: null })),
			).toBeUndefined();
		});
	});

	describe("anthropicOutputText", () => {
		test("joins multiple text blocks in order", () => {
			const resp = makeResp({
				content: [
					{ type: "text", text: "foo" },
					{ type: "text", text: " bar" },
					{ type: "text", text: " baz" },
				],
			});
			expect(anthropicOutputText(resp)).toBe("foo bar baz");
		});
		test("returns empty string when no text blocks", () => {
			const resp = makeResp({
				content: [{ type: "tool_use", id: "x", name: "f", input: {} }],
			});
			expect(anthropicOutputText(resp)).toBe("");
		});
		test("returns empty string when content is empty", () => {
			expect(anthropicOutputText(makeResp({ content: [] }))).toBe("");
		});
		test("returns empty string when content is missing", () => {
			expect(
				anthropicOutputText({
					...makeResp(),
					content: undefined as unknown as AnthropicMessagesResponse["content"],
				}),
			).toBe("");
		});
	});

	describe("anthropicReasoningText", () => {
		test("returns undefined when no thinking blocks", () => {
			const resp = makeResp({ content: [{ type: "text", text: "hi" }] });
			expect(anthropicReasoningText(resp)).toBeUndefined();
		});
		test("joins thinking block text", () => {
			const resp = makeResp({
				content: [{ type: "thinking", thinking: "deep reasoning" }],
			});
			expect(anthropicReasoningText(resp)).toBe("deep reasoning");
		});
		test("joins multiple thinking blocks in order", () => {
			const resp = makeResp({
				content: [
					{ type: "thinking", thinking: "step 1: " },
					{ type: "thinking", thinking: "step 2" },
				],
			});
			expect(anthropicReasoningText(resp)).toBe("step 1: step 2");
		});
		test("text-only response yields undefined", () => {
			const resp = makeResp({
				content: [{ type: "text", text: "no thinking" }],
			});
			expect(anthropicReasoningText(resp)).toBeUndefined();
		});
	});

	describe("anthropicResponseUsage", () => {
		test("returns null when usage missing", () => {
			const resp = makeResp();
			resp.usage = undefined as unknown as AnthropicMessagesResponse["usage"];
			expect(anthropicResponseUsage(resp)).toBeNull();
		});
		test("computes total_tokens and includes cached_tokens when present", () => {
			const resp = makeResp({
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 20,
				},
			});
			expect(anthropicResponseUsage(resp)).toEqual({
				input_tokens: 100,
				output_tokens: 50,
				total_tokens: 150,
				input_tokens_details: { cached_tokens: 20 },
			});
		});
		test("omits cached_tokens when zero or absent", () => {
			const resp = makeResp({ usage: { input_tokens: 5, output_tokens: 3 } });
			expect(anthropicResponseUsage(resp)).toEqual({
				input_tokens: 5,
				output_tokens: 3,
				total_tokens: 8,
			});
		});
	});
});
