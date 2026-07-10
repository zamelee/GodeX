// src/providers/anthropic/spec.ts
//
// ProviderSpec for the Anthropic Messages API (Phase B3.2).
//
// The spec is the single source of truth for:
//   - provider name and wire protocol (MESSAGES_PROTOCOL)
//   - default base URL and auth scheme (x-api-key)
//   - capability map consumed by the bridge compatibility planner
//   - tool name codec (stateful; reversible mapping Codex <-> Anthropic)
//   - response + stream accessors (B4 fills these; B3.2 ships safe stubs)
//   - patchRequest hook (B3.4 extends)
//
// Phase B3.3 wires createAnthropicProviderEdge() in client.ts on top of this
// spec. Phase B5 adds minimax-anthropic as a thin spec wrapper pointing at
// https://minnimax.chat with the same auth shape.

import {
	MESSAGES_PROTOCOL,
	type ProviderSpec,
	X_API_KEY_AUTH,
} from "../../bridge/provider-spec";
import type { ResponseUsage } from "../../protocol/openai/responses";
import { ANTHROPIC_SPEC_CAPABILITIES, anthropicPatchRequest } from "./hooks";
import type {
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent,
} from "./protocol";
import { AnthropicToolNameCodec } from "./tool-name-codec";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_BASE_URL = ANTHROPIC_BASE_URL;
export const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
export const ANTHROPIC_PROVIDER_NAME = "anthropic";

// --- B3.2 accessor stubs ---
//
// These return safe defaults until B4 wires the sync response reconstructor.
// firstChoice / outputText are not meaningful for the Anthropic response
// shape (there is no `choices` array — content is at the top level) but the
// bridge layer still expects these accessors to exist.

function anthropicFirstChoice(
	_response: AnthropicMessagesResponse,
): unknown | undefined {
	return undefined;
}

function anthropicFinishReason(
	response: AnthropicMessagesResponse,
): string | undefined {
	return response.stop_reason ?? undefined;
}

function anthropicOutputText(_response: AnthropicMessagesResponse): string {
	// B4 fills this by joining text blocks in response.content.
	return "";
}

function anthropicReasoningText(
	_response: AnthropicMessagesResponse,
): string | undefined {
	return undefined;
}

function anthropicResponseUsage(
	response: AnthropicMessagesResponse,
): ResponseUsage | null {
	const u = response.usage;
	if (!u) return null;
	const total = u.input_tokens + u.output_tokens;
	const usage: ResponseUsage = {
		input_tokens: u.input_tokens,
		output_tokens: u.output_tokens,
		total_tokens: total,
	};
	if (u.cache_read_input_tokens && u.cache_read_input_tokens > 0) {
		usage.input_tokens_details = {
			cached_tokens: u.cache_read_input_tokens,
		};
	}
	return usage;
}

function anthropicStreamDeltas(_chunk: AnthropicStreamEvent): unknown[] {
	// B4 fills this with ProviderSpecStreamDelta[] arrays. Until then the
	// bridge layer sees an empty stream and reports no progress.
	return [];
}

/**
 * Construct a fresh Anthropic ProviderSpec. Each call returns a new spec
 * with its own AnthropicToolNameCodec instance so concurrent ProviderEdge
 * instances do not share tool-name mapping state.
 */
export function createAnthropicSpec(): ProviderSpec<
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
	AnthropicStreamEvent
> {
	return {
		name: ANTHROPIC_PROVIDER_NAME,
		protocol: MESSAGES_PROTOCOL,
		capabilities: ANTHROPIC_SPEC_CAPABILITIES,
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
