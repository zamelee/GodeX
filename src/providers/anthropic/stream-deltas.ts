// src/providers/anthropic/stream-deltas.ts
//
// Map Anthropic Messages API SSE events to neutral ProviderStreamDelta[].
// (Phase B4)
//
// Anthropic SSE events are typed via the data payload `type` field:
//
//   message_start            - opens a new assistant message. Carries the
//                              initial usage (input_tokens + output_tokens=1).
//   content_block_start      - opens a content block. tool_use blocks carry
//                              id+name; text/thinking start empty.
//   content_block_delta      - incremental update to a content block.
//                              text_delta emits text, input_json_delta emits
//                              a toolCall.arguments chunk, thinking_delta
//                              emits reasoning. signature_delta is opaque
//                              and dropped (Anthropic requires it on the wire
//                              to verify thinking integrity, but the bridge
//                              does not need it).
//   content_block_stop       - bookkeeping, no delta.
//   message_delta            - final stop_reason + output_tokens update.
//                              We translate stop_reason to Chat-style and
//                              emit finishReason.
//   message_stop             - bookkeeping, no delta.
//   ping                     - heartbeat, no delta.
//   error                    - upstream reported a fatal error; emit error.
//
// Usage emission strategy: we emit usage once on message_start (the only
// event carrying input_tokens). message_delta.usage is partial (only
// output_tokens) and overwriting the snapshot would lose input_tokens,
// so we intentionally skip it. The final token totals are available
// through the response.usage accessor when Codex closes the stream.

import type { ProviderStreamDelta } from "../../bridge/stream";
import type { ResponseUsage } from "../../protocol/openai/responses";
import type {
	AnthropicContentBlockStart,
	AnthropicDelta,
	AnthropicMessagesResponse,
	AnthropicStopReason,
	AnthropicStreamEvent,
	AnthropicToolUseBlockStart,
} from "./protocol";

export function anthropicStreamDeltas(
	event: AnthropicStreamEvent,
): ProviderStreamDelta[] {
	switch (event.type) {
		case "message_start":
			return messageStartDeltas(event.message);
		case "content_block_start":
			return contentBlockStartDeltas(event.index, event.content_block);
		case "content_block_delta":
			return contentBlockDeltaDeltas(event.index, event.delta);
		case "content_block_stop":
			return [];
		case "message_delta":
			return messageDeltaDeltas(event.delta.stop_reason ?? null);
		case "message_stop":
			return [];
		case "ping":
			return [];
		case "error":
			return [
				{
					error: {
						code: "server_error",
						message: event.error.message,
					},
				},
			];
	}
	// Defensive default: unknown event types yield no deltas. The bridge
	// stream-reconstructor ignores empty delta arrays.
	return [];
}

/**
 * message_start carries the initial usage with input_tokens set.
 * We surface it as a usage delta so the response snapshot has correct
 * input_tokens; final output_tokens (from message_delta) cannot be merged
 * here without crossing the stateless mapper contract, so we accept the
 * slight staleness.
 */
function messageStartDeltas(
	message: AnthropicMessagesResponse,
): ProviderStreamDelta[] {
	const usage = usageFromMessage(message);
	return usage ? [{ usage }] : [];
}

function usageFromMessage(
	message: AnthropicMessagesResponse,
): ResponseUsage | null {
	const u = message.usage;
	if (!u) return null;
	const usage: ResponseUsage = {
		input_tokens: u.input_tokens,
		output_tokens: u.output_tokens,
		total_tokens: u.input_tokens + u.output_tokens,
	};
	if (u.cache_read_input_tokens && u.cache_read_input_tokens > 0) {
		usage.input_tokens_details = { cached_tokens: u.cache_read_input_tokens };
	}
	return usage;
}

/**
 * content_block_start: emit a toolCall delta with id+name for tool_use.
 * text/thinking/redacted_thinking open with empty content (text/thinking
 * fill in via subsequent content_block_delta events).
 */
function contentBlockStartDeltas(
	index: number,
	block: AnthropicContentBlockStart,
): ProviderStreamDelta[] {
	if (block.type !== "tool_use") return [];
	const use = block as AnthropicToolUseBlockStart;
	return [
		{
			toolCall: {
				index,
				id: use.id,
				type: "function",
				name: use.name,
			},
		},
	];
}

/**
 * content_block_delta: dispatch on the delta subtype. text_delta -> text,
 * input_json_delta -> toolCall.arguments, thinking_delta -> reasoning,
 * signature_delta -> drop (opaque on the wire).
 */
function contentBlockDeltaDeltas(
	index: number,
	delta: AnthropicDelta,
): ProviderStreamDelta[] {
	switch (delta.type) {
		case "text_delta":
			return delta.text ? [{ text: delta.text }] : [];
		case "thinking_delta":
			return delta.thinking ? [{ reasoning: delta.thinking }] : [];
		case "input_json_delta":
			return delta.partial_json
				? [{ toolCall: { index, arguments: delta.partial_json } }]
				: [];
		case "signature_delta":
			// signature is opaque; Anthropic uses it to verify extended-thinking
			// integrity, but the bridge does not surface it.
			return [];
	}
	// Discriminator exhaustiveness: the union above covers every variant.
	return [];
}

/**
 * message_delta: emit finishReason (translating Anthropic stop_reason to
 * the Chat-style values that mapProviderFinishReason recognizes).
 */
function messageDeltaDeltas(
	stopReason: AnthropicStopReason | null,
): ProviderStreamDelta[] {
	if (stopReason === null || stopReason === undefined) return [];
	const mapped = translateStopReason(stopReason);
	return mapped === undefined ? [] : [{ finishReason: mapped }];
}

function translateStopReason(sr: AnthropicStopReason): string | undefined {
	switch (sr) {
		case "end_turn":
			return "stop";
		case "tool_use":
			return "tool_calls";
		case "max_tokens":
			return "length";
		case "stop_sequence":
			return "stop";
	}
}
