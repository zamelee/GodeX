// src/providers/anthropic/accessors.ts
//
// Anthropic Messages API response accessors (Phase B4).
//
// These replace the B3.2 stubs in spec.ts. They translate Anthropic wire
// shapes into the bridge layer neutral view:
//
//   firstChoice       - synthesize a Chat-style {message:{tool_calls:[]}}
//                       object derived from response.content tool_use blocks.
//                       bridge/response/response-reconstructor.ts reads
//                       choice.message.tool_calls to extract function calls.
//   finishReason      - map Anthropic stop_reason onto the Chat-style values
//                       that mapProviderFinishReason recognizes. Without
//                       this translation, end_turn/tool_use would land in
//                       the default branch and surface as a failed response.
//   outputText        - join every text block in response.content.
//   reasoningText     - join every thinking block in response.content; the
//                       encrypted signature is opaque and never round-trips.
//   usage             - already implemented in B3.2; duplicated here for
//                       direct-import ergonomics (cache_creation_input_tokens
//                       folded into input_tokens_details).

import type { ResponseUsage } from "../../protocol/openai/responses";
import type {
	AnthropicContentBlock,
	AnthropicMessagesResponse,
	AnthropicStopReason,
	AnthropicTextBlock,
	AnthropicThinkingBlock,
	AnthropicToolUseBlock,
} from "./protocol";

export interface AnthropicFirstChoiceShape {
	readonly message: {
		readonly tool_calls: readonly AnthropicFirstChoiceToolCall[];
	};
}

export interface AnthropicFirstChoiceToolCall {
	readonly id: string;
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

export function anthropicFirstChoice(
	response: AnthropicMessagesResponse,
): AnthropicFirstChoiceShape | undefined {
	if (!Array.isArray(response.content) || response.content.length === 0) {
		return undefined;
	}
	const toolCalls = extractToolCalls(response.content);
	return { message: { tool_calls: toolCalls } };
}

function extractToolCalls(
	content: readonly AnthropicContentBlock[],
): readonly AnthropicFirstChoiceToolCall[] {
	const out: AnthropicFirstChoiceToolCall[] = [];
	for (const block of content) {
		if (block.type !== "tool_use") continue;
		const use = block as AnthropicToolUseBlock;
		out.push({
			id: use.id,
			type: "function",
			function: {
				name: use.name,
				arguments: serializeToolInput(use.input),
			},
		});
	}
	return out;
}

function serializeToolInput(input: unknown): string {
	if (input === undefined || input === null) return "{}";
	if (typeof input === "string") return input;
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

export function anthropicFinishReason(
	response: AnthropicMessagesResponse,
): string | undefined {
	const sr = response.stop_reason;
	if (sr === undefined) return undefined;
	if (sr === null) return undefined;
	switch (sr as AnthropicStopReason) {
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

export function anthropicOutputText(
	response: AnthropicMessagesResponse,
): string {
	if (!Array.isArray(response.content)) return "";
	let out = "";
	for (const block of response.content) {
		if (block.type === "text") {
			out += (block as AnthropicTextBlock).text;
		}
	}
	return out;
}

export function anthropicReasoningText(
	response: AnthropicMessagesResponse,
): string | undefined {
	if (!Array.isArray(response.content)) return undefined;
	let hasAny = false;
	let out = "";
	for (const block of response.content) {
		if (block.type === "thinking") {
			hasAny = true;
			out += (block as AnthropicThinkingBlock).thinking;
		}
	}
	return hasAny ? out : undefined;
}

export function anthropicResponseUsage(
	response: AnthropicMessagesResponse,
): ResponseUsage | null {
	const u = response.usage;
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
