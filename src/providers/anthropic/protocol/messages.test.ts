import { describe, expect, test } from "bun:test";
import type {
	AnthropicContentBlock,
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent,
	AnthropicTool,
	AnthropicToolChoice,
} from "./index";

describe("Anthropic protocol DTOs (Phase B3.1)", () => {
	test("barrel re-exports the request, response, and stream types", () => {
		// The test compiles only if each type is exported. Construct a zero-arg
		// type reference for each so tsc verifies the names are present.
		const _request: AnthropicMessagesRequest | null = null;
		const _response: AnthropicMessagesResponse | null = null;
		const _event: AnthropicStreamEvent | null = null;
		expect(_request).toBeNull();
		expect(_response).toBeNull();
		expect(_event).toBeNull();
	});

	test("request body accepts every content-block variant", () => {
		const blocks: AnthropicContentBlock[] = [
			{ type: "text", text: "hello" },
			{
				type: "image",
				source: { type: "url", url: "https://example.com/cat.png" },
			},
			{
				type: "tool_use",
				id: "toolu_01",
				name: "get_weather",
				input: { city: "Tokyo" },
			},
			{
				type: "tool_result",
				tool_use_id: "toolu_01",
				content: "sunny",
			},
		];

		const request: AnthropicMessagesRequest = {
			model: "claude-3-5-sonnet-20241022",
			messages: [{ role: "user", content: blocks }],
			max_tokens: 1024,
			system: "You are a helpful assistant.",
			tools: [
				{
					name: "get_weather",
					description: "Get current weather",
					input_schema: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			],
			tool_choice: { type: "auto" },
		};
		expect(request.messages[0]?.content).toHaveLength(4);
	});

	test("tool_choice accepts all four variants", () => {
		const choices: AnthropicToolChoice[] = [
			{ type: "auto" },
			{ type: "any" },
			{ type: "tool", name: "get_weather" },
			{ type: "none" },
		];
		expect(choices).toHaveLength(4);
	});

	test("stream event payload discriminates by type field", () => {
		const samples: AnthropicStreamEvent[] = [
			{
				type: "message_start",
				message: {
					id: "msg_01",
					type: "message",
					role: "assistant",
					content: [],
					model: "claude-3-5-sonnet-20241022",
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hi" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "input_json_delta", partial_json: '{"city":' },
			},
			{
				type: "content_block_delta",
				index: 1,
				delta: { type: "thinking_delta", thinking: "Hmm" },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: { output_tokens: 5 },
			},
			{ type: "message_stop" },
			{ type: "ping" },
			{ type: "error", error: { type: "api_error", message: "boom" } },
		];
		expect(samples).toHaveLength(10);

		// Round-trip parse: a JSON payload with the right shape should narrow correctly.
		const parsed: AnthropicStreamEvent = JSON.parse(
			'{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}',
		);
		if (parsed.type === "content_block_delta") {
			if (parsed.delta.type === "text_delta") {
				expect(parsed.delta.text).toBe("x");
			}
		}
	});

	test("tool name codec surface (placeholder for B3.2)", () => {
		// B3.2 will add AnthropicToolNameCodec.toProviderName / fromProviderName.
		// For now this just pins the AnthropicTool name field type as string so the
		// type-level scaffolding is in place.
		const tool: AnthropicTool = {
			name: "get_weather",
			input_schema: { type: "object" },
		};
		expect(tool.name).toBe("get_weather");
	});
});
