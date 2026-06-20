import type { GodexPlugin } from "../bridge/plugins";
import type {
	ProviderEdge,
	ProviderRuntimeConfig,
} from "../bridge/provider-spec";

export interface ProviderDefinition {
	readonly name: string;
	create(
		config: ProviderRuntimeConfig,
		plugins?: readonly GodexPlugin[],
	): ProviderEdge<unknown, unknown, unknown>;
}

export function createProviderDefinition<
	TBridgeRequest,
	TRes,
	TChunk,
	TProviderRequest = TBridgeRequest,
>(
	name: string,
	create: (
		config: ProviderRuntimeConfig,
		plugins?: readonly GodexPlugin[],
	) => ProviderEdge<TBridgeRequest, TRes, TChunk, TProviderRequest>,
): ProviderDefinition {
	return {
		name,
		create: (config, plugins) =>
			create(config, plugins) as ProviderEdge<unknown, unknown, unknown>,
	};
}
