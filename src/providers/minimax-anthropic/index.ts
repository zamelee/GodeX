// src/providers/minimax-anthropic/index.ts
//
// Barrel for the minnimax.chat Anthropic-protocol provider.
//
// Phase B5: thin wrapper around src/providers/anthropic that points at
// https://minnimax.chat. Re-exports the shared protocol DTOs and
// tool-name codec so consumers do not need a parallel import path.

export { createMiniMaxAnthropicProviderEdge } from "./client";
export {
	createMiniMaxAnthropicSpec,
	MINIMAX_ANTHROPIC_BASE_URL,
	MINIMAX_ANTHROPIC_DEFAULT_BASE_URL,
	MINIMAX_ANTHROPIC_DEFAULT_MODEL,
	MINIMAX_ANTHROPIC_PROVIDER_NAME,
	MINIMAX_ANTHROPIC_SPEC,
} from "./spec";
// Note: AnthropicToolNameCodec and the Anthropic protocol DTOs are
// re-exported from src/providers/anthropic. The src/module-boundaries
// contract forbids re-exporting across directories from this barrel, so
// consumers that need the protocol types should import them directly
// from the anthropic provider (../anthropic/protocol) or from this
// package's own ./spec, which already re-exposes them via its generic
// ProviderSpec<AnthropicMessagesRequest, AnthropicMessagesResponse,
// AnthropicStreamEvent> typing.
