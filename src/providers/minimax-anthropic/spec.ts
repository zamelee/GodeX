// src/providers/minimax-anthropic/spec.ts
//
// ProviderSpec for the Anthropic-protocol endpoint at minnimax.chat.
//
// Phase B5: thin wrapper that reuses every accessor, stream delta, hook,
// tool-name codec, and protocol DTO from src/providers/anthropic. The only
// deltas from ANTHROPIC_MESSAGES_SPEC are:
//   - name: "minimax-anthropic" (so Codex++ can disambiguate from the
//     OpenAI-protocol "minimax" provider already registered)
//   - endpoint.defaultBaseURL: https://minnimax.chat (overrides api.anthropic.com)
//   - default model: claude-3-5-sonnet-20241022 (same default as upstream
//     Anthropic; minnimax.chat accepts the standard claude model ids)
//
// All other ProviderSpec fields (protocol, auth, capabilities, toolName,
// response accessors, stream deltas, hooks) are shared by reference.

import {
	MESSAGES_PROTOCOL,
	type ProviderSpec,
	X_API_KEY_AUTH,
} from "../../bridge/provider-spec";
import {
	anthropicFinishReason,
	anthropicFirstChoice,
	anthropicOutputText,
	anthropicReasoningText,
	anthropicResponseUsage,
} from "../anthropic/accessors";
import {
	ANTHROPIC_SPEC_CAPABILITIES,
	anthropicPatchRequest,
} from "../anthropic/hooks";
import type {
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent,
} from "../anthropic/protocol";
import { anthropicStreamDeltas } from "../anthropic/stream-deltas";
import { AnthropicToolNameCodec } from "../anthropic/tool-name-codec";

export const MINIMAX_ANTHROPIC_BASE_URL = "https://minnimax.chat";
export const MINIMAX_ANTHROPIC_DEFAULT_BASE_URL = MINIMAX_ANTHROPIC_BASE_URL;
export const MINIMAX_ANTHROPIC_DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
export const MINIMAX_ANTHROPIC_PROVIDER_NAME = "minimax-anthropic";

/**
 * Per-instance overrides applied on top of ANTHROPIC_SPEC_CAPABILITIES.
 * Only maxTools is honored today, keeping the factories source-compatible with zero-arg callers.
 * with their previous zero-arg call sites.
 */
export interface AnthropicSpecOverrides {
	readonly maxTools?: number;
}

/**
 * Returns a shallow-cloned ProviderCapabilities with the provided overrides
 * applied. Mutating the original ANTHROPIC_SPEC_CAPABILITIES is forbidden
 * (callers share it by reference), so we explicitly rebuild the tools
 * object before reassigning.
 */
export function applyAnthropicCapabilityOverrides(
	base: typeof ANTHROPIC_SPEC_CAPABILITIES,
	overrides: AnthropicSpecOverrides | undefined,
): typeof ANTHROPIC_SPEC_CAPABILITIES {
	if (overrides?.maxTools === undefined) return base;
	if (overrides.maxTools === base.tools.maxTools) return base;
	return {
		...base,
		tools: { ...base.tools, maxTools: overrides.maxTools },
	};
}

/**
 * Construct a fresh minnimax.chat ProviderSpec. Each call returns a new
 * spec with its own AnthropicToolNameCodec instance so concurrent
 * ProviderEdge instances do not share tool-name mapping state. Mirrors
 * the pattern established by createAnthropicSpec().
 */
export function createMiniMaxAnthropicSpec(
	overrides?: AnthropicSpecOverrides,
): ProviderSpec<
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent
> {
	return {
		name: MINIMAX_ANTHROPIC_PROVIDER_NAME,
		protocol: MESSAGES_PROTOCOL,
		capabilities: applyAnthropicCapabilityOverrides(
			ANTHROPIC_SPEC_CAPABILITIES,
			overrides,
		),
		endpoint: {
			defaultBaseURL: MINIMAX_ANTHROPIC_DEFAULT_BASE_URL,
		},
		auth: X_API_KEY_AUTH,
		toolName: new AnthropicToolNameCodec(),
		response: {
			firstChoice: anthropicFirstChoice,
			finishReason: anthropicFinishReason,
			outputText: anthropicOutputText,
			reasoningText: anthropicReasoningText,
			usage: anthropicResponseUsage,
		},
		stream: {
			deltas: anthropicStreamDeltas,
		},
		hooks: {
			patchRequest: anthropicPatchRequest,
		},
		streamMode: "passthrough",
	};
}

/**
 * Default singleton for places that need a static spec reference (e.g. the
 * provider registry). The codec inside this instance is shared and
 * accumulates mapping state across requests; client.ts should prefer
 * createMiniMaxAnthropicSpec() per ProviderEdge to keep sessions isolated.
 */
export const MINIMAX_ANTHROPIC_SPEC: ProviderSpec<
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent
> = createMiniMaxAnthropicSpec();
