// src/providers/anthropic/messages-provider-client.ts
//
// HTTP client wrapper for the Anthropic Messages API. Mirrors
// src/providers/shared/chat-provider-client.ts but targets MessagesApi
// instead of ChatApi. Error wrapping is delegated to the shared
// provider-error module so the Chat- and Messages-protocol clients
// share one implementation.

import { wrapProviderError } from "../shared/provider-error";
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
			throw await wrapProviderError(err, this.provider, body.model);
		}
	}

	async stream(body: AnthropicMessagesRequest) {
		try {
			return await this.api.streamMessages({
				...body,
				stream: true,
			} as AnthropicMessagesRequest);
		} catch (err) {
			throw await wrapProviderError(err, this.provider, body.model);
		}
	}
}
