import type { ResponsesContext } from "../context/responses-context";
import type {
	ResponseObject,
	ResponseStreamEvent,
} from "../protocol/openai/responses";
import type { ResponsesBridge } from "./bridge";
import { BrowserFunctionLoop } from "./browser-function-loop";
import { ProviderExchange } from "./provider-exchange";
import { StreamPipeline } from "./stream-pipeline";
import { SyncRequestPipeline } from "./sync-request-pipeline";

export interface ResponsesSyncPipeline {
	request(ctx: ResponsesContext): Promise<ResponseObject>;
}

export interface ResponsesStreamPipeline {
	stream(ctx: ResponsesContext): Promise<ReadableStream<ResponseStreamEvent>>;
}

export class ResponsesBridgeRuntime implements ResponsesBridge {
	private readonly syncPipeline: ResponsesSyncPipeline;
	private readonly streamPipeline: ResponsesStreamPipeline;

	constructor(
		syncPipeline?: ResponsesSyncPipeline,
		streamPipeline?: ResponsesStreamPipeline,
	) {
		const exchange = new ProviderExchange();
		const baseSync = syncPipeline ?? new SyncRequestPipeline(exchange);
		this.syncPipeline =
			process.env.GODEX_DISABLE_BROWSER_FUNCTION_LOOP === "1"
				? baseSync
				: new BrowserFunctionLoop(baseSync);
		this.streamPipeline = streamPipeline ?? new StreamPipeline(exchange);
	}

	async request(ctx: ResponsesContext): Promise<ResponseObject> {
		return this.syncPipeline.request(ctx);
	}

	async stream(
		ctx: ResponsesContext,
	): Promise<ReadableStream<ResponseStreamEvent>> {
		return this.streamPipeline.stream(ctx);
	}
}
