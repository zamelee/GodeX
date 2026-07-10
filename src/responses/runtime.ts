import type { ResponsesContext } from "../context/responses-context";
import type {
	ResponseCreateRequest,
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

export type ResponsesStreamMode = "passthrough" | "wrap";

export interface ResponsesBridgeRuntimeOptions {
	streamMode?: ResponsesStreamMode;
	disableBrowserFunctionLoop?: boolean;
}

export class ResponsesBridgeRuntime implements ResponsesBridge {
	private readonly syncPipeline: ResponsesSyncPipeline;
	private readonly streamPipeline: ResponsesStreamPipeline;
	private readonly streamMode: ResponsesStreamMode;

	constructor(
		syncPipeline?: ResponsesSyncPipeline,
		streamPipeline?: ResponsesStreamPipeline,
		options: ResponsesBridgeRuntimeOptions = {},
	) {
		const exchange = new ProviderExchange();
		const baseSync = syncPipeline ?? new SyncRequestPipeline(exchange);
		// Options take precedence over env so tests can pin behaviour
		// without polluting process.env. Production callers (which pass
		// no options) still resolve from env: GODEX_DISABLE_BROWSER_FUNCTION_LOOP=1
		// short-circuits the BrowserFunctionLoop wrapper, and
		// GODEX_STREAM_MODE=passthrough skips the wrap-mode SSE synthesis.
		const disableBrowserLoop =
			options.disableBrowserFunctionLoop ??
			process.env.GODEX_DISABLE_BROWSER_FUNCTION_LOOP === "1";
		this.syncPipeline = disableBrowserLoop
			? baseSync
			: new BrowserFunctionLoop(baseSync);
		this.streamPipeline = streamPipeline ?? new StreamPipeline(exchange);
		// Path D, plan D: stream mode absorbs function calls server-side via
		// the sync loop, then re-emits the final ResponseObject as a synthetic
		// SSE event stream. This is what makes godex_chrome_* work when
		// Codex++ issues stream: true requests. Set GODEX_STREAM_MODE=passthrough
		// to fall back to the original behavior (function calls delivered to
		// the client; useful for clients that execute them locally).
		this.streamMode =
			options.streamMode ??
			(process.env.GODEX_STREAM_MODE === "passthrough"
				? "passthrough"
				: "wrap");
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
			// The upstream Chat Completions API returns SSE when stream: true
			// is set, which the sync JSON parser cannot consume. Force the
			// upstream call to be non-streaming for the duration of the loop
			// and restore the original flag afterwards. ctx.request is declared
			// readonly so we narrow through unknown for this controlled
			// reassignment (see provider-exchange.test.ts for the same
			// pattern).
			const mutableCtx = ctx as unknown as {
				request: ResponseCreateRequest;
			};
			const wasStream = mutableCtx.request.stream;
			mutableCtx.request = { ...mutableCtx.request, stream: false };
			try {
				const finalResponse = await this.syncPipeline.request(
					mutableCtx as ResponsesContext,
				);
				return wrapResponseObjectAsSseStream(finalResponse, ctx);
			} finally {
				mutableCtx.request = { ...mutableCtx.request, stream: wasStream };
			}
		}
		return this.streamPipeline.stream(ctx);
	}
}
