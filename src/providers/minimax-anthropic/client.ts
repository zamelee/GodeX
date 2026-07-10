// src/providers/minimax-anthropic/client.ts
//
// Factory: `createMiniMaxAnthropicProviderEdge(config, plugins?)`.
//
// Mirrors `src/providers/anthropic/client.ts` exactly. The only difference
// is the spec object passed into `createProviderEdge`: a fresh
// createMiniMaxAnthropicSpec() with endpoint.defaultBaseURL pointing at
// https://minnimax.chat instead of https://api.anthropic.com.
//
// The HTTP transport (MessagesProviderClient) is shared with the upstream
// anthropic provider because minnimax.chat is API-compatible with the
// Anthropic Messages protocol (POST /v1/messages with x-api-key auth,
// tool_use blocks, thinking blocks, stop_reason semantics).

import type { GodexPlugin } from "../../bridge/plugins";
import type { ProviderRuntimeConfig } from "../../bridge/provider-spec";
import { createProviderEdge } from "../../bridge/provider-spec";
import { MessagesProviderClient } from "../anthropic/messages-provider-client";
import {
	createMiniMaxAnthropicSpec,
	MINIMAX_ANTHROPIC_PROVIDER_NAME,
} from "./spec";

export function createMiniMaxAnthropicProviderEdge(
	config: ProviderRuntimeConfig,
	plugins?: readonly GodexPlugin[],
) {
	const spec = createMiniMaxAnthropicSpec();
	const client = new MessagesProviderClient({
		provider: MINIMAX_ANTHROPIC_PROVIDER_NAME,
		baseURL: config.endpoint?.base_url ?? spec.endpoint.defaultBaseURL,
		apiKey: config.credentials.api_key,
		timeout: config.timeout_ms,
	});

	return createProviderEdge({
		spec,
		config,
		plugins,
		request: client.request.bind(client),
		stream: client.stream.bind(client),
	});
}
