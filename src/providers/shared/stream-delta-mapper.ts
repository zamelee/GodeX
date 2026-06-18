import type { ProviderStreamDelta } from "../../bridge/stream";

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
}

export function mapCommonChatStreamDelta(
	delta: ChatStreamDeltaLike,
): ProviderStreamDelta[] {
	const deltas: ProviderStreamDelta[] = [];
	if (delta.reasoning_content) {
		deltas.push({ reasoning: delta.reasoning_content });
	}
	for (const toolCall of delta.tool_calls ?? []) {
		const providerToolCall = {
			...(toolCall.index != null ? { index: toolCall.index } : {}),
			...(toolCall.id != null ? { id: toolCall.id } : {}),
			...(toolCall.type != null ? { type: toolCall.type } : {}),
			...(toolCall.function?.name != null
				? { name: toolCall.function.name }
				: {}),
			...(toolCall.function?.arguments != null
				? { arguments: toolCall.function.arguments }
				: {}),
		};
		if (Object.keys(providerToolCall).length > 0) {
			deltas.push({ toolCall: providerToolCall });
		}
	}
	return deltas;
}
