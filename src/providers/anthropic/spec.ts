// src/providers/anthropic/spec.ts
//
// ProviderSpec for the Anthropic Messages API (Phase B3.2 + B4).
//
// The spec is the single source of truth for:
//   - provider name and wire protocol (MESSAGES_PROTOCOL)
//   - default base URL and auth scheme (x-api-key)
//   - capability map consumed by the bridge compatibility planner
//   - tool name codec (stateful; reversible mapping Codex <-> Anthropic)
//   - response accessors (B4 fills these from accessors.ts)
//   - stream deltas (B4 fills these from stream-deltas.ts)
//   - patchRequest hook (B3.4 stub; B4 leaves as identity transform)
//
// B4 wiring: response + stream accessors now import from the dedicated
// modules so the same accessor logic is reusable by minimax-anthropic (B5).

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
} from "./accessors";
import { ANTHROPIC_SPEC_CAPABILITIES, anthropicPatchRequest } from "./hooks";
import type {
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent,
} from "./protocol";
import { anthropicStreamDeltas } from "./stream-deltas";
import { AnthropicToolNameCodec } from "./tool-name-codec";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_BASE_URL = ANTHROPIC_BASE_URL;
export const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
export const ANTHROPIC_PROVIDER_NAME = "anthropic";

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
 * Construct a fresh Anthropic ProviderSpec. Each call returns a new spec
 * with its own AnthropicToolNameCodec instance so concurrent ProviderEdge
 * instances do not share tool-name mapping state.
 */
export function createAnthropicSpec(
	overrides?: AnthropicSpecOverrides,
): ProviderSpec<
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent
> {
	return {
		name: ANTHROPIC_PROVIDER_NAME,
		protocol: MESSAGES_PROTOCOL,
		capabilities: applyAnthropicCapabilityOverrides(
			ANTHROPIC_SPEC_CAPABILITIES,
			overrides,
		),
		endpoint: {
			defaultBaseURL: ANTHROPIC_DEFAULT_BASE_URL,
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
 * provider registry in B3.3). The codec inside this instance is shared and
 * accumulates mapping state across requests; client.ts should prefer
 * createAnthropicSpec() per ProviderEdge to keep sessions isolated.
 */
export const ANTHROPIC_MESSAGES_SPEC: ProviderSpec<
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent
> = createAnthropicSpec();
