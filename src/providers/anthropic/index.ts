// src/providers/anthropic/index.ts
//
// Barrel for the Anthropic provider.
//
// Phase B3.1: protocol DTOs (request/response/stream).
// Phase B3.2: spec, hooks, tool-name-codec.
// Phase B3.3: messages-api, messages-provider-client, client factory.

export { createAnthropicProviderEdge } from "./client";
export { ANTHROPIC_SPEC_CAPABILITIES, anthropicPatchRequest } from "./hooks";
export * from "./protocol";
export {
	ANTHROPIC_BASE_URL,
	ANTHROPIC_DEFAULT_BASE_URL,
	ANTHROPIC_DEFAULT_MODEL,
	ANTHROPIC_MESSAGES_SPEC,
	ANTHROPIC_PROVIDER_NAME,
	createAnthropicSpec,
} from "./spec";
export * from "./tool-name-codec";
