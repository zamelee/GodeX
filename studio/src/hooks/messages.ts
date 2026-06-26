// Studio Hooks — Layer 3
//
// messages.ts
// Hook A: transformChatMessages
//
// Handles:
//  1. Strip [Attached media from tool result XXXX] marker text from user messages
//     (these are injected by godex normalizer and should not go to the provider).
//  2. Canonicalize tool call arguments (empty string → "{}").
//
// Both transforms only apply to MiniMax provider. Other providers pass through unchanged.

import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateRequest,
	ChatCompletionMessageParam,
} from "../../../src/protocol/openai/completions";
import type { GodexPluginContext } from "../../../src/bridge/plugins";
import {
	canonicalizeFunctionArguments,
	canonicalizeMessageToolArguments,
} from "./args";

// Marker text injected by godex input-normalizer.ts toolExtrasUserMessage()
const MEDIA_MARKER_RE = /^\[Attached media from tool result [^\]]+\]$/;

/**
 * Returns true if the message is a user message containing only the media marker
 * text (with optional leading newline).
 */
function isMediaMarkerOnlyUserMessage(
	msg: ChatCompletionMessageParam,
): boolean {
	if (msg.role !== "user") return false;
	const content = typeof msg.content === "string" ? msg.content : null;
	if (!content) return false;
	// The normalizer injects a user message like: role:user, content:"[Attached media from tool result ...]"
	// which contains ONLY the marker text. Strip it.
	const trimmed = content.trim();
	return MEDIA_MARKER_RE.test(trimmed);
}

/**
 * Drop [Attached media from tool result ...] user messages injected by godex.
 * These messages should not go to the provider as-is.
 */
function dropMediaMarkerMessages(
	messages: readonly ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
	return messages.filter((msg) => !isMediaMarkerOnlyUserMessage(msg));
}

/**
 * Hook A: transformChatMessages
 *
 * Applied after godex's normalizer builds ChatCompletionMessageParam[].
 *
 * 1. Strip media marker user messages (MiniMax doesn't want them).
 * 2. Canonicalize tool call arguments (MiniMax rejects empty-string args).
 *
 * Other providers pass through unchanged.
 */
export async function transformChatMessages(
	messages: readonly ChatCompletionMessageParam[],
	ctx: GodexPluginContext,
): Promise<ChatCompletionMessageParam[]> {
	if (ctx.provider !== "minimax") return [...messages];

	// Step 1: drop media marker user messages
	let result = dropMediaMarkerMessages(messages);

	// Step 2: canonicalize tool call arguments
	result = canonicalizeMessageToolArguments(result);

	return result;
}
