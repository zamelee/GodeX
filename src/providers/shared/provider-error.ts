// src/providers/shared/provider-error.ts
//
// Canonical provider-error wrapping helpers shared between Chat- and
// Messages-protocol clients. Extracted from chat-provider-client.ts in
// R26 of the GodeX polish round so both `wrapMessagesProviderError`
// (Anthropic) and `wrapProviderError` (Chat) collapse to one impl.
//
// See handoffs/2026-07-09-fclass-step1-bridge-accessor-rename.md
// Round 26 for the dedup rationale.

import { ExchangeError } from "@ahoo-wang/fetcher";
import {
	PROVIDER_UPSTREAM_ERROR,
	PROVIDER_UPSTREAM_RATE_LIMIT,
	PROVIDER_UPSTREAM_SERVER_ERROR,
	PROVIDER_UPSTREAM_TIMEOUT,
	ProviderError,
} from "../../error";

export async function wrapProviderError(
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

export function providerErrorCode(status: number): string {
	if (status === 408) return PROVIDER_UPSTREAM_TIMEOUT;
	if (status === 429) return PROVIDER_UPSTREAM_RATE_LIMIT;
	if (status >= 500) return PROVIDER_UPSTREAM_SERVER_ERROR;
	return PROVIDER_UPSTREAM_ERROR;
}

export function extractErrorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (typeof error === "object" && error !== null && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}

export async function safeResponseJson(
	response: Response | undefined,
): Promise<unknown> {
	if (!response) return null;
	try {
		return await response.json();
	} catch {
		return null;
	}
}
