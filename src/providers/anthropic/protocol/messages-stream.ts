// src/providers/anthropic/protocol/messages-stream.ts
//
// Anthropic Messages API SSE event DTOs (Phase B3.1).
//
// Wire shape: event: <type>\ndata: <json>\n\n per Anthropic SSE convention.
// The TypeScript event-name discriminator is the `type` field inside the data payload.
//
// Thinking deltas are included so Phase B3.4 (builder) can fold OQ3 mapping in
// without a follow-up type revision.
//
// Reference: https://docs.anthropic.com/en/api/messages-streaming

import type {
	AnthropicMessagesResponse,
	AnthropicStopReason,
} from "./messages-response";

// --- Content block shape at content_block_start ---
export interface AnthropicTextBlockStart {
	type: "text";
	text: string;
}

export interface AnthropicToolUseBlockStart {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface AnthropicThinkingBlockStart {
	type: "thinking";
	thinking: string;
}

export interface AnthropicRedactedThinkingBlockStart {
	type: "redacted_thinking";
	data: string;
}

export type AnthropicContentBlockStart =
	| AnthropicTextBlockStart
	| AnthropicToolUseBlockStart
	| AnthropicThinkingBlockStart
	| AnthropicRedactedThinkingBlockStart;

// --- Delta types (content_block_delta.delta) ---
export type AnthropicDelta =
	| { type: "text_delta"; text: string }
	| { type: "input_json_delta"; partial_json: string }
	| { type: "thinking_delta"; thinking: string }
	| { type: "signature_delta"; signature: string };

// --- SSE events (data payload) ---
export interface AnthropicMessageStartEvent {
	type: "message_start";
	message: AnthropicMessagesResponse;
}

export interface AnthropicContentBlockStartEvent {
	type: "content_block_start";
	index: number;
	content_block: AnthropicContentBlockStart;
}

export interface AnthropicContentBlockDeltaEvent {
	type: "content_block_delta";
	index: number;
	delta: AnthropicDelta;
}

export interface AnthropicContentBlockStopEvent {
	type: "content_block_stop";
	index: number;
}

export interface AnthropicMessageDeltaEvent {
	type: "message_delta";
	delta: {
		stop_reason?: AnthropicStopReason;
		stop_sequence?: string | null;
	};
	usage?: { output_tokens: number };
}

export interface AnthropicMessageStopEvent {
	type: "message_stop";
}

export interface AnthropicPingEvent {
	type: "ping";
}

export interface AnthropicErrorEvent {
	type: "error";
	error: {
		type: string;
		message: string;
	};
}

export type AnthropicStreamEvent =
	| AnthropicMessageStartEvent
	| AnthropicContentBlockStartEvent
	| AnthropicContentBlockDeltaEvent
	| AnthropicContentBlockStopEvent
	| AnthropicMessageDeltaEvent
	| AnthropicMessageStopEvent
	| AnthropicPingEvent
	| AnthropicErrorEvent;
