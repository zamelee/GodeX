// Studio Hooks — Layer 3
//
// stream.ts
// Hook C: transformStreamDelta
//
// Applied to raw SSE chunks from the provider before the delta mapper runs.
// Only touches MiniMax streaming chunks.
//
// Transform: drop null-valued fields from tool_call deltas.
//
// MiniMax sometimes sends continuation chunks with id=null, name=null, and only
// arguments carrying the new fragment. The bridge must never see null fields.
import type { GodexPluginContext } from "../../../src/bridge/plugins";

export interface ChatStreamToolCallDeltaLike {
	readonly index?: number | null;
	readonly id?: string | null;
	readonly type?: string | null;
	readonly function?: {
		readonly name?: string | null;
		readonly arguments?: string | null;
	};
}

export interface ChatStreamDeltaLike {
	readonly reasoning_content?: string | null;
	readonly tool_calls?: readonly ChatStreamToolCallDeltaLike[];
	readonly content?: string | null;
	readonly [key: string]: unknown;
}

/**
 * Returns true if value is a non-null primitive or a non-null object.
 */
function isPresent(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	return true;
}

/**
 * Filter null fields from a tool call delta.
 * MiniMax sends id=null, name=null in continuation chunks — we drop those.
 */
function sanitizeToolCall(call: ChatStreamToolCallDeltaLike): ChatStreamToolCallDeltaLike {
	const result: ChatStreamToolCallDeltaLike = {} as ChatStreamToolCallDeltaLike;

	if (isPresent(call.index)) (result as Record<string, unknown>).index = call.index as number;
	if (isPresent(call.id)) (result as Record<string, unknown>).id = call.id as string;
	if (isPresent(call.type)) (result as Record<string, unknown>).type = call.type as string;
	if (call.function) {
		const fn: { name?: string; arguments?: string } = {};
		if (isPresent(call.function.name)) fn.name = call.function.name as string;
		if (isPresent(call.function.arguments)) fn.arguments = call.function.arguments as string;
		(result as Record<string, unknown>).function = fn;
	}

	return result;
}

/**
 * Hook C: transformStreamDelta
 *
 * Strips null-valued fields from tool_call deltas in provider SSE chunks.
 * MiniMax sometimes sends null id/name/type in streaming continuation chunks.
 */
export async function transformStreamDelta(
	delta: unknown,
	ctx: GodexPluginContext,
): Promise<unknown> {
	if (ctx.provider !== "minimax") return delta;

	const d = delta as ChatStreamDeltaLike;
	if (!d.tool_calls || d.tool_calls.length === 0) return delta;

	// Check if any tool call actually has nulls that need filtering
	const needsSanitization = d.tool_calls.some(
		(call) =>
			call.id === null ||
			call.type === null ||
			call.function?.name === null ||
			call.function?.arguments === null,
	);

	if (!needsSanitization) return delta;

	return {
		...d,
		tool_calls: d.tool_calls.map((call) => sanitizeToolCall(call)),
	};
}