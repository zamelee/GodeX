// src/providers/anthropic/protocol/messages-request.ts
//
// Anthropic Messages API request DTOs (Phase B3.1).
//
// Wire spec: POST {base_url}/v1/messages
// Headers:  x-api-key, anthropic-version: 2023-06-01, content-type: application/json
//
// Shared content-block types here are imported by messages-response.ts and
// messages-stream.ts so request/response/stream shapes stay in sync.
//
// Reference: https://docs.anthropic.com/en/api/messages

export type AnthropicModel = string;

// --- Cache control (prompt caching, optional) ---
export interface AnthropicCacheControl {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

// --- Content blocks (messages[].content and system) ---
export interface AnthropicTextBlock {
	type: "text";
	text: string;
	cache_control?: AnthropicCacheControl;
}

export interface AnthropicImageBlock {
	type: "image";
	source:
		| { type: "base64"; media_type: string; data: string }
		| { type: "url"; url: string };
	cache_control?: AnthropicCacheControl;
}

export interface AnthropicToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
	cache_control?: AnthropicCacheControl;
}

export interface AnthropicToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content: string | AnthropicContentBlock[];
	is_error?: boolean;
	cache_control?: AnthropicCacheControl;
}

export type AnthropicContentBlock =
	| AnthropicTextBlock
	| AnthropicImageBlock
	| AnthropicToolUseBlock
	| AnthropicToolResultBlock;

// --- Messages ---
export interface AnthropicUserMessage {
	role: "user";
	content: string | AnthropicContentBlock[];
}

export interface AnthropicAssistantMessage {
	role: "assistant";
	content: string | AnthropicContentBlock[];
}

export type AnthropicMessage = AnthropicUserMessage | AnthropicAssistantMessage;

// --- Tool definition ---
export interface AnthropicTool {
	name: string;
	description?: string;
	input_schema: {
		type: "object";
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
	cache_control?: AnthropicCacheControl;
}

// --- Tool choice ---
export type AnthropicToolChoice =
	| { type: "auto" }
	| { type: "any" }
	| { type: "tool"; name: string }
	| { type: "none" };

// --- Thinking (OQ3 fold-in: Phase B3 builder maps Codex reasoning.effort here) ---
export type AnthropicThinkingConfig =
	| { type: "enabled"; budget_tokens: number }
	| { type: "disabled" };

// --- Metadata ---
export interface AnthropicMetadata {
	user_id?: string;
}

// --- Main request body ---
export interface AnthropicMessagesRequest {
	model: AnthropicModel;
	messages: AnthropicMessage[];
	max_tokens: number;
	system?: string | AnthropicTextBlock[];
	tools?: AnthropicTool[];
	tool_choice?: AnthropicToolChoice;
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	stop_sequences?: string[];
	metadata?: AnthropicMetadata;
	thinking?: AnthropicThinkingConfig;
}
