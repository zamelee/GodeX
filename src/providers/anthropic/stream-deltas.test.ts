import { describe, expect, test } from "bun:test";
import type {
	AnthropicContentBlockDeltaEvent,
	AnthropicContentBlockStartEvent,
	AnthropicErrorEvent,
	AnthropicMessageDeltaEvent,
	AnthropicMessageStartEvent,
	AnthropicStreamEvent,
} from "./protocol";
import { anthropicStreamDeltas } from "./stream-deltas";

describe("Anthropic stream deltas (Phase B4)", () => {
	describe("content_block_start", () => {
		test("text block start produces no deltas (text arrives via deltas)", () => {
			const event: AnthropicContentBlockStartEvent = {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([]);
		});

		test("tool_use block start emits toolCall delta with id+name+index", () => {
			const event: AnthropicContentBlockStartEvent = {
				type: "content_block_start",
				index: 1,
				content_block: {
					type: "tool_use",
					id: "toolu_01",
					name: "get_weather",
					input: {},
				},
			};
			const deltas = anthropicStreamDeltas(event);
			expect(deltas).toEqual([
				{
					toolCall: {
						index: 1,
						id: "toolu_01",
						type: "function",
						name: "get_weather",
					},
				},
			]);
		});

		test("thinking block start produces no deltas (reasoning arrives via deltas)", () => {
			const event: AnthropicContentBlockStartEvent = {
				type: "content_block_start",
				index: 0,
				content_block: { type: "thinking", thinking: "" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([]);
		});
	});

	describe("content_block_delta", () => {
		test("text_delta emits text delta with payload", () => {
			const event: AnthropicContentBlockDeltaEvent = {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "hello" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([{ text: "hello" }]);
		});

		test("text_delta with empty text produces no deltas", () => {
			const event: AnthropicContentBlockDeltaEvent = {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([]);
		});

		test("input_json_delta emits toolCall arguments delta with index", () => {
			const event: AnthropicContentBlockDeltaEvent = {
				type: "content_block_delta",
				index: 2,
				delta: { type: "input_json_delta", partial_json: '{"cit' },
			};
			expect(anthropicStreamDeltas(event)).toEqual([
				{ toolCall: { index: 2, arguments: '{"cit' } },
			]);
		});

		test("thinking_delta emits reasoning delta", () => {
			const event: AnthropicContentBlockDeltaEvent = {
				type: "content_block_delta",
				index: 1,
				delta: { type: "thinking_delta", thinking: "considering" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([
				{ reasoning: "considering" },
			]);
		});

		test("signature_delta is dropped (opaque on the wire)", () => {
			const event: AnthropicContentBlockDeltaEvent = {
				type: "content_block_delta",
				index: 1,
				delta: { type: "signature_delta", signature: "abc123" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([]);
		});
	});

	describe("message_start", () => {
		test("emits usage delta with full input_tokens + initial output_tokens", () => {
			const event: AnthropicMessageStartEvent = {
				type: "message_start",
				message: {
					id: "msg_01",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [],
					stop_reason: null,
					usage: {
						input_tokens: 100,
						output_tokens: 1,
						cache_read_input_tokens: 20,
					},
				},
			};
			expect(anthropicStreamDeltas(event)).toEqual([
				{
					usage: {
						input_tokens: 100,
						output_tokens: 1,
						total_tokens: 101,
						input_tokens_details: { cached_tokens: 20 },
					},
				},
			]);
		});

		test("message_start with usage missing produces no deltas", () => {
			// Defensive: upstream shim may omit usage. Bridge must not crash.
			const event: AnthropicMessageStartEvent = {
				type: "message_start",
				message: {
					id: "msg_x",
					type: "message",
					role: "assistant",
					model: "m",
					content: [],
					stop_reason: null,
					usage:
						undefined as unknown as AnthropicMessageStartEvent["message"]["usage"],
				},
			};
			expect(anthropicStreamDeltas(event)).toEqual([]);
		});
	});

	describe("message_delta", () => {
		test("stop_reason end_turn emits finishReason stop", () => {
			const event: AnthropicMessageDeltaEvent = {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([{ finishReason: "stop" }]);
		});

		test("stop_reason tool_use emits finishReason tool_calls", () => {
			const event: AnthropicMessageDeltaEvent = {
				type: "message_delta",
				delta: { stop_reason: "tool_use" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([
				{ finishReason: "tool_calls" },
			]);
		});

		test("stop_reason max_tokens emits finishReason length", () => {
			const event: AnthropicMessageDeltaEvent = {
				type: "message_delta",
				delta: { stop_reason: "max_tokens" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([
				{ finishReason: "length" },
			]);
		});

		test("stop_reason stop_sequence emits finishReason stop", () => {
			const event: AnthropicMessageDeltaEvent = {
				type: "message_delta",
				delta: { stop_reason: "stop_sequence" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([{ finishReason: "stop" }]);
		});

		test("missing stop_reason produces no deltas", () => {
			const event: AnthropicMessageDeltaEvent = {
				type: "message_delta",
				delta: {},
			};
			expect(anthropicStreamDeltas(event)).toEqual([]);
		});

		test("usage payload on message_delta is dropped (stateless mapper cannot combine with message_start)", () => {
			// Usage emission strategy documented in stream-deltas.ts header: we only emit
			// usage on message_start because message_delta's partial usage would overwrite
			// the snapshot's input_tokens. The final token totals arrive via response.usage
			// when Codex closes the stream.
			const event: AnthropicMessageDeltaEvent = {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 25 },
			};
			// Only finishReason is emitted; usage is intentionally dropped.
			expect(anthropicStreamDeltas(event)).toEqual([{ finishReason: "stop" }]);
		});
	});

	describe("bookkeeping events produce no deltas", () => {
		test("content_block_stop is ignored", () => {
			expect(
				anthropicStreamDeltas({ type: "content_block_stop", index: 0 }),
			).toEqual([]);
		});
		test("message_stop is ignored", () => {
			expect(anthropicStreamDeltas({ type: "message_stop" })).toEqual([]);
		});
		test("ping heartbeat is ignored", () => {
			expect(anthropicStreamDeltas({ type: "ping" })).toEqual([]);
		});
	});

	describe("error event", () => {
		test("emits error delta with server_error code", () => {
			const event: AnthropicErrorEvent = {
				type: "error",
				error: { type: "api_error", message: "rate limited" },
			};
			expect(anthropicStreamDeltas(event)).toEqual([
				{ error: { code: "server_error", message: "rate limited" } },
			]);
		});
	});

	describe("bridge conformance", () => {
		test("deltas never include undefined field values", () => {
			// Mirrors the conformance test in provider-stream-deltas.test.ts: every delta
			// emitted from a stream event must not contain undefined fields.
			const events: AnthropicStreamEvent[] = [
				{
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "t", name: "f", input: {} },
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "x" },
				},
				{ type: "message_delta", delta: { stop_reason: "end_turn" } },
			];
			for (const ev of events) {
				for (const delta of anthropicStreamDeltas(ev)) {
					expect(Object.values(delta as Record<string, unknown>)).not.toContain(
						undefined,
					);
				}
			}
		});

		test("toolCall deltas with all fields populated never serialize empty entries", () => {
			// Even tool_use blocks with empty input should emit a complete delta (index, id,
			// type, name). Empty deltas would be silently dropped by the state machine.
			const ev: AnthropicContentBlockStartEvent = {
				type: "content_block_start",
				index: 0,
				content_block: { type: "tool_use", id: "t", name: "f", input: {} },
			};
			const deltas = anthropicStreamDeltas(ev);
			expect(deltas).toHaveLength(1);
			expect(deltas[0]?.toolCall).toBeDefined();
		});
	});
});
