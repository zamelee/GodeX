// Studio Hooks — Layer 3
//
// Each hook is migrated from godex hardcode.
// All hooks run async, chain in registration order, errors propagate.

// ─── args.ts ────────────────────────────────────────────────────────────────
// Hook B helpers: canonicalize tool call arguments.

import type { ChatCompletionMessageParam } from "../../../src/protocol/openai/completions";

const EMPTY_OBJECT = "{}";

/**
 * MiniMax (and some other providers) require valid JSON in tool call arguments.
 * Empty string "" is not valid JSON and causes 400 errors.
 * This canonicalizes to "{}" and also re-serializes to normalize whitespace.
 */
export function canonicalizeFunctionArguments(argumentsValue: string): string {
	if (argumentsValue === "") return EMPTY_OBJECT;
	try {
		return JSON.stringify(JSON.parse(argumentsValue));
	} catch {
		return argumentsValue;
	}
}

/**
 * Returns true if the arguments value is acceptable for Chat Completions.
 * Empty string is considered valid (will be canonicalized to "{}").
 */
export function isValidFunctionArguments(argumentsValue: string): boolean {
	if (argumentsValue === "") return true;
	try {
		const parsed = JSON.parse(argumentsValue);
		return parsed !== undefined;
	} catch {
		return false;
	}
}

/**
 * Apply canonicalizeFunctionArguments to every tool_call.arguments in a message array.
 * Only touches assistant messages with tool_calls.
 */
export function canonicalizeMessageToolArguments(
	messages: readonly ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
	return messages.map((message) => {
		if (message.role !== "assistant") return message;
		const calls = message.tool_calls;
		if (!calls || calls.length === 0) return message;
		return {
			...message,
			tool_calls: calls.map((call) => {
				if (call.type !== "function") return call;
				return {
					...call,
					function: {
						...call.function!,
						arguments: canonicalizeFunctionArguments(call.function?.arguments ?? ""),
					},
				};
			}),
		} as ChatCompletionMessageParam;
	});
}