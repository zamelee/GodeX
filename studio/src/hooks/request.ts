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
} from "../../../godex/src/protocol/openai/completions";
import type { GodexPluginContext } from "../../../godex/src/bridge/plugins";

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

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
	const req = request as unknown as Record<string, unknown>;
	const miniMax: MiniMaxRequest = {
		...request,
	};

	// Remove reasoning_effort (OpenAI-only field)
	delete miniMax.reasoning_effort;

	// Set reasoning_split=true for MiniMax
	miniMax.reasoning_split = true;

	// Normalize thinking: "enabled" → "adaptive", "disabled" → "disabled"
	if ("thinking" in req) {
		const thinking = req.thinking as ChatCompletionThinking | undefined;
		miniMax.thinking = normalizeMiniMaxThinking(thinking);
	}

	// Convert max_tokens → max_completion_tokens
	if (typeof request.max_tokens === "number") {
		miniMax.max_completion_tokens = request.max_tokens;
		delete miniMax.max_tokens;
	}

	return miniMax as unknown as ChatCompletionCreateRequest;
}
