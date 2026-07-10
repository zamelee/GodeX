// src/providers/anthropic/messages-provider-client.ts
//
// HTTP client wrapper for the Anthropic Messages API. Mirrors
// `src/providers/shared/chat-provider-client.ts` but targets MessagesApi
// instead of ChatApi.
//
// Error wrapping logic is duplicated from chat-provider-client.ts for now;
// Phase B4 will extract `wrapProviderError` to `src/providers/shared/provider-error.ts`
// so both clients (and any future protocol) can reuse it.

import { ExchangeError } from "@ahoo-wang/fetcher";
import {
	PROVIDER_UPSTREAM_ERROR,
	PROVIDER_UPSTREAM_RATE_LIMIT,
	PROVIDER_UPSTREAM_SERVER_ERROR,
	PROVIDER_UPSTREAM_TIMEOUT,
	ProviderError,
} from "../../error";
import type { MessagesApiOptions } from "./messages-api";
import { messagesApi } from "./messages-api";
import type {
	AnthropicMessagesRequest,
	AnthropicMessagesResponse,
} from "./protocol";

export interface MessagesProviderClientOptions extends MessagesApiOptions {
	provider: string;
}

export class MessagesProviderClient {
	private readonly api: ReturnType<typeof messagesApi>;
	private readonly provider: string;

	constructor(options: MessagesProviderClientOptions) {
		this.api = messagesApi(options);
		this.provider = options.provider;
	}

	async request(
		body: AnthropicMessagesRequest,
	): Promise<AnthropicMessagesResponse> {
		try {
			return await this.api.messages(body);
		} catch (err) {
			throw await wrapMessagesProviderError(err, this.provider, body.model);
		}
	}

	async stream(body: AnthropicMessagesRequest) {
		try {
			return await this.api.streamMessages({
				...body,
				stream: true,
			} as AnthropicMessagesRequest);
		} catch (err) {
			throw await wrapMessagesProviderError(err, this.provider, body.model);
		}
	}
}

async function wrapMessagesProviderError(
	err: unknown,
	provider: string,
	model: string | undefined,
): Promise<unknown> {
	const modelTag = model ?? "unknown";
	if (
		err instanceof Error &&
		(err.name === "FetchTimeoutError" || err.name === "TimeoutError")
	) {
		return new ProviderError(PROVIDER_UPSTREAM_TIMEOUT, "Request timed out", {
			provider,
			model: modelTag,
			upstreamStatus: 408,
		});
	}

	if (err instanceof ExchangeError) {
		const { exchange } = err;
		const hasResponse = exchange.response !== undefined;
		const status = exchange.response?.status ?? 502;
		const body = await safeResponseJson(exchange.response);
		const message =
			typeof body === "object" && body !== null && "error" in body
				? extractErrorMessage((body as { error: unknown }).error)
				: hasResponse
					? `Upstream returned ${status}`
					: "Upstream request failed";
		return new ProviderError(
			hasResponse ? providerErrorCode(status) : PROVIDER_UPSTREAM_ERROR,
			message,
			{
				provider,
				model: modelTag,
				upstreamStatus: status,
				upstreamBody: body,
			},
		);
	}

	const message = err instanceof Error ? err.message : String(err);
	return new ProviderError(
		PROVIDER_UPSTREAM_ERROR,
		message || "Upstream request failed",
		{
			provider,
			model: modelTag,
			upstreamStatus: 502,
		},
		err instanceof Error ? { cause: err } : undefined,
	);
}

function providerErrorCode(status: number): string {
	if (status === 408) return PROVIDER_UPSTREAM_TIMEOUT;
	if (status === 429) return PROVIDER_UPSTREAM_RATE_LIMIT;
	if (status >= 500) return PROVIDER_UPSTREAM_SERVER_ERROR;
	return PROVIDER_UPSTREAM_ERROR;
}

function extractErrorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (typeof error === "object" && error !== null && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}

async function safeResponseJson(
	response: Response | undefined,
): Promise<unknown> {
	if (!response) return null;
	try {
		return await response.json();
	} catch {
		return null;
	}
}
