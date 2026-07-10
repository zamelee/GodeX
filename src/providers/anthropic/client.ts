// src/providers/anthropic/client.ts
//
// Factory: `createAnthropicProviderEdge(config, plugins?)`.
//
// Mirrors `src/providers/minimax/client.ts`:
//   1. Construct a MessagesProviderClient pointing at the resolved base URL.
//   2. Pass its request/stream methods to `createProviderEdge` together with
//      the spec so the bridge layer can plan compatibility + call hooks.
//
// Each call returns a fresh ProviderEdge backed by a fresh codec (via the
// factory form of the spec, `createAnthropicSpec()`).

import type { GodexPlugin } from "../../bridge/plugins";
import type { ProviderRuntimeConfig } from "../../bridge/provider-spec";
import { createProviderEdge } from "../../bridge/provider-spec";
import { MessagesProviderClient } from "./messages-provider-client";
import { ANTHROPIC_PROVIDER_NAME, createAnthropicSpec } from "./spec";

export function createAnthropicProviderEdge(
	config: ProviderRuntimeConfig,
	plugins?: readonly GodexPlugin[],
) {
	const spec = createAnthropicSpec();
	const client = new MessagesProviderClient({
		provider: ANTHROPIC_PROVIDER_NAME,
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
