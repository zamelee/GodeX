import type { ChatApi, ChatApiOptions } from "./chat-api";
import { chatApi } from "./chat-api";
import { wrapProviderError } from "./provider-error";

export interface ChatProviderClientOptions extends ChatApiOptions {
	provider: string;
}

type StreamableRequest = { model?: string; stream?: boolean };

export class ChatProviderClient<TReq extends StreamableRequest, TRes, TChunk> {
	private readonly api: ChatApi<TReq, TRes, TChunk>;
	private readonly provider: string;

	constructor(options: ChatProviderClientOptions) {
		this.api = chatApi(options);
		this.provider = options.provider;
	}

	async request(body: TReq): Promise<TRes> {
		try {
			return await this.api.chatCompletions(body);
		} catch (err) {
			throw await wrapProviderError(err, this.provider, body.model);
		}
	}

	async stream(body: TReq) {
		try {
			return await this.api.streamChatCompletions({
				...body,
				stream: true,
			} as TReq);
		} catch (err) {
			throw await wrapProviderError(err, this.provider, body.model);
		}
	}
}
