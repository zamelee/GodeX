import type { JsonServerSentEvent } from "@ahoo-wang/fetcher-eventstream";
import type {
	ResponseItem,
	ResponseUsage,
} from "../../protocol/openai/responses";
import type { ProviderCapabilities } from "../compatibility";

export type ProviderSpecStreamDelta = unknown;
export const CHAT_COMPLETIONS_PROTOCOL = "chat_completions" as const;
export const MESSAGES_PROTOCOL = "messages" as const;
export type ProviderProtocol =
	| typeof CHAT_COMPLETIONS_PROTOCOL
	| typeof MESSAGES_PROTOCOL;
export const BEARER_AUTH_SCHEME = "bearer" as const;
export const X_API_KEY_AUTH_SCHEME = "x_api_key" as const;
export type ProviderAuthScheme =
	| typeof BEARER_AUTH_SCHEME
	| typeof X_API_KEY_AUTH_SCHEME;

export interface ProviderRuntimeConfig {
	readonly spec: string;
	readonly credentials: { readonly api_key: string };
	readonly endpoint?: { readonly base_url?: string };
	readonly timeout_ms?: number;
	/**
	 * Optional override for provider capabilities.tools.maxTools. When set,
	 * the spec factory passes it into capabilities.tools.maxTools instead of
	 * the provider default. Lets us relax a too-strict limit per-provider
	 * without lifting the global default (which should track upstream reality).
	 */
	readonly max_tools?: number;
}

export interface ProviderEndpointSpec {
	readonly defaultBaseURL: string;
}

export interface ProviderAuthSpec {
	readonly scheme: ProviderAuthScheme;
}

export const BEARER_AUTH: ProviderAuthSpec = { scheme: BEARER_AUTH_SCHEME };
export const X_API_KEY_AUTH: ProviderAuthSpec = {
	scheme: X_API_KEY_AUTH_SCHEME,
};

export interface ToolNameCodec {
	toProviderName(name: string): string;
	fromProviderName(name: string): string | undefined;
}

export interface BridgeResponseAccessor<TResponse> {
	firstChoice(response: TResponse): unknown | undefined;
	finishReason(response: TResponse): string | undefined;
	outputText(response: TResponse): string;
	reasoningText?(response: TResponse): string | undefined;
	webSearchCalls?(response: TResponse): ResponseItem[];
	usage(response: TResponse): ResponseUsage | null;
}

export interface BridgeStreamAccessor<TChunk> {
	deltas(chunk: TChunk): ProviderSpecStreamDelta[];
}

export interface ProviderHooks<
	TBridgeRequest,
	TResponse,
	TChunk,
	TProviderRequest = TBridgeRequest,
> {
	patchRequest?(request: TBridgeRequest): TProviderRequest;
	normalizeResponse?(response: TResponse): TResponse;
	normalizeChunk?(chunk: TChunk): TChunk;
}

export interface ProviderRequestOptions<TProviderRequest = unknown> {
	onPatchedRequest?(body: TProviderRequest): void;
	onRequestPrepared?(body: TProviderRequest): void;
}

export interface ProviderSpec<
	TBridgeRequest,
	TResponse,
	TChunk,
	TProviderRequest = TBridgeRequest,
> {
	readonly name: string;
	/**
	 * Provider wire protocol. Defaults to `CHAT_COMPLETIONS_PROTOCOL`
	 * when absent; explicit setting is preferred.
	 */
	readonly protocol?: ProviderProtocol;
	readonly capabilities: ProviderCapabilities;
	readonly endpoint: ProviderEndpointSpec;
	readonly auth: ProviderAuthSpec;
	/**
	 * Stream mode preference for this provider. Defaults to per-protocol
	 * default at runtime when absent (`wrap` for chat_completions,
	 * `passthrough` for messages). Env var `GODEX_STREAM_MODE` overrides.
	 */
	readonly streamMode?: "passthrough" | "wrap";
	readonly toolName: ToolNameCodec;
	readonly response: BridgeResponseAccessor<TResponse>;
	readonly stream: BridgeStreamAccessor<TChunk>;
	readonly hooks?: ProviderHooks<
		TBridgeRequest,
		TResponse,
		TChunk,
		TProviderRequest
	>;
}

export interface ProviderEdge<
	TBridgeRequest,
	TResponse,
	TChunk,
	TProviderRequest = TBridgeRequest,
> {
	readonly name: string;
	readonly spec: ProviderSpec<
		TBridgeRequest,
		TResponse,
		TChunk,
		TProviderRequest
	>;
	request(
		body: TBridgeRequest,
		options?: ProviderRequestOptions<TProviderRequest>,
	): Promise<TResponse>;
	stream(
		body: TBridgeRequest,
		options?: ProviderRequestOptions<TProviderRequest>,
	): Promise<ReadableStream<JsonServerSentEvent<TChunk>>>;
}
