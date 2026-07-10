// src/providers/anthropic/protocol/messages-response.ts
//
// Anthropic Messages API sync response DTOs (Phase B3.1).
//
// Reference: https://docs.anthropic.com/en/api/messages

import type { AnthropicContentBlock, AnthropicModel } from "./messages-request";

export type AnthropicStopReason =
	| "end_turn"
	| "max_tokens"
	| "stop_sequence"
	| "tool_use";

export interface AnthropicUsage {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	service_tier?: "standard" | "priority" | "batch";
}

export interface AnthropicMessagesResponse {
	id: string;
	type: "message";
	role: "assistant";
	content: AnthropicContentBlock[];
	model: AnthropicModel;
	stop_reason: AnthropicStopReason | null;
	stop_sequence: string | null;
	usage: AnthropicUsage;
}
