// Studio Hooks — Layer 3
//
// request.ts
// Hook B: patchRequest
//
// Applied after the provider spec patchRequest and before the HTTP call.
// Can override provider-specific request fields.
//
// MiniMax-specific transforms:
//  - reasoning_effort → reasoning_split=true (always enable reasoning split)
//  - max_tokens → max_completion_tokens
//  - thinking: { type: "disabled" } → { type: "disabled" } (pass-through)
//  - thinking: { type: "enabled" } → { type: "adaptive" }

import type {
	ChatCompletionCreateRequest,
	ChatCompletionMessageParam,
	ChatCompletionThinking,
} from "../../../src/protocol/openai/completions";
import type { GodexPluginContext } from "../../../src/bridge/plugins";

export interface MiniMaxRequest {
	model?: string;
	messages?: ChatCompletionMessageParam[];
	stream?: boolean;
	reasoning_split?: boolean;
	thinking?: { type: "disabled" | "adaptive" };
	max_completion_tokens?: number;
	[key: string]: unknown;
}

/**
 * Normalize OpenAI-style reasoning_effort / thinking fields to MiniMax format.
 * MiniMax uses reasoning_split=true and thinking:{type:"adaptive"|"disabled"}.
 */
function normalizeMiniMaxThinking(
	thinking: ChatCompletionThinking | undefined,
): { type: "disabled" | "adaptive" } | undefined {
	if (!thinking) return undefined;
	return thinking.type === "disabled"
		? { type: "disabled" }
		: { type: "adaptive" };
}

/**
 * Hook B: patchRequest
 *
 * Converts OpenAI-style reasoning parameters to MiniMax-specific fields:
 *  - reasoning_effort → reasoning_split=true (force on for MiniMax)
 *  - max_tokens → max_completion_tokens
 *  - thinking → MiniMax {type:"adaptive"|"disabled"}
 *
 * Also sets reasoning_split=true unconditionally (MiniMax prefers it enabled).
 */
export async function patchRequest(
	request: ChatCompletionCreateRequest,
	ctx: GodexPluginContext,
): Promise<ChatCompletionCreateRequest> {
	if (ctx.provider !== "minimax") return request;

	// Build MiniMax request, dropping incompatible thinking field first
	const { reasoning_effort, thinking, max_tokens, ...rest } = request;
	const miniMax: MiniMaxRequest = {
		...rest,
		reasoning_split: true,
		thinking: normalizeMiniMaxThinking(thinking),
	} as MiniMaxRequest;

	// Convert max_tokens → max_completion_tokens
	if (typeof max_tokens === "number") {
		miniMax.max_completion_tokens = max_tokens;
	}

	return miniMax as unknown as ChatCompletionCreateRequest;
}