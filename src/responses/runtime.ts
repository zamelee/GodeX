import type { ResponsesContext } from "../context/responses-context";
import type {
	ResponseObject,
	ResponseStreamEvent,
} from "../protocol/openai/responses";
import type { ResponsesBridge } from "./bridge";
import { BrowserFunctionLoop } from "./browser-function-loop";
import { ProviderExchange } from "./provider-exchange";
import { wrapResponseObjectAsSseStream } from "./response-object-stream";
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
	private readonly streamMode: "passthrough" | "wrap";

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
		// Path D, plan D: stream mode absorbs function calls server-side via
		// the sync loop, then re-emits the final ResponseObject as a synthetic
		// SSE event stream. This is what makes `godex_chrome_*` work when
		// Codex++ issues `stream: true` requests. Set
		// GODEX_STREAM_MODE=passthrough to fall back to the original behavior
		// (function calls delivered to the client; useful for clients that
		// execute them locally).
		this.streamMode =
			process.env.GODEX_STREAM_MODE === "passthrough" ? "passthrough" : "wrap";
	}

	async request(ctx: ResponsesContext): Promise<ResponseObject> {
		return this.syncPipeline.request(ctx);
	}

	async stream(
		ctx: ResponsesContext,
	): Promise<ReadableStream<ResponseStreamEvent>> {
		if (this.streamMode === "wrap") {
			// Run the agentic loop (including godex_chrome_* execution) in
			// sync mode, then wrap the final ResponseObject as SSE. See
			// response-object-stream.ts for the event envelope details.
			const finalResponse = await this.syncPipeline.request(ctx);
			return wrapResponseObjectAsSseStream(finalResponse, ctx);
		}
		return this.streamPipeline.stream(ctx);
	}
}
