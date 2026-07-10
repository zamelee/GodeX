import { describe, expect, test } from "bun:test";
import type { ProviderEdge } from "../bridge/provider-spec";
import { DEFAULT_WEB_SEARCH_CONFIG } from "../config/sections/web-search";
import { OutputContractSlot } from "../context/output-contract-slot";
import type { ResponsesContext } from "../context/responses-context";
import type {
	ResponseObject,
	ResponseStreamEvent,
} from "../protocol/openai/responses";
import type { ResponseSessionStore, StoredResponseSession } from "../session";
import {
	completedTextResponse,
	createTestProviderEdge,
} from "../testing/provider-edge";
import { ResponsesBridgeRuntime } from "./runtime";

function createMockProvider(
	text = "",
	streamEvents: Array<{ event: string; data: unknown }> = [],
): ProviderEdge<unknown, unknown, unknown> {
	return createTestProviderEdge({
		name: "mock",
		response: completedTextResponse(text),
		streamEvents,
	});
}

function createMockSessionStore(): ResponseSessionStore & {
	saved: StoredResponseSession[];
} {
	const saved: StoredResponseSession[] = [];
	return {
		saved,
		get: async () => null,
		save: async (session: StoredResponseSession) => {
			saved.push(session);
		},
		resolveChain: async () =>
			({
				previous_response_id: "none",
				turns: [],
				input_items: [],
			}) as never,
		delete: async () => {},
	};
}

function createMockCtx(
	provider: ProviderEdge<unknown, unknown, unknown>,
	sessionStore: ResponseSessionStore,
): ResponsesContext {
	return {
		provider,
		app: {
			config: { web_search: DEFAULT_WEB_SEARCH_CONFIG },
			search: {
				name: "none",
				available: false,
				search: async () => {
					throw new Error("search is unavailable in this runtime test");
				},
			},
			sessionStore,
			traceEnabled: true,
			traceRecorder: { record: () => {} },
			plugins: [],
		},
		logger: {
			info: () => {},
			debug: () => {},
			trace: () => {},
			error: () => {},
			warn: () => {},
		},
		request: { model: "mock/test", input: "hello", store: true },
		requestId: "req_test",
		responseId: "resp_123",
		createdAt: Math.floor(Date.now() / 1000),
		resolved: { provider: "test", model: "test" },
		diagnostics: [],
		addDiagnostic() {},
		attributes: new Map(),
		outputContract: new OutputContractSlot(),
		session: null,
	} as unknown as ResponsesContext;
}

async function readStream<T>(stream: ReadableStream<T>): Promise<T[]> {
	const reader = stream.getReader();
	const chunks: T[] = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return chunks;
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
}

describe("ResponsesBridgeRuntime", () => {
	test("default construction wires a working sync pipeline", async () => {
		const provider = createMockProvider("sync text");
		const sessionStore = createMockSessionStore();
		const ctx = createMockCtx(provider, sessionStore);

		const result = await new ResponsesBridgeRuntime().request(ctx);

		expect(result).toMatchObject({
			id: "resp_123",
			status: "completed",
			output_text: "sync text",
		});
		expect(sessionStore.saved[0]?.id).toBe("resp_123");
	});

	test("default construction wires a working wrap-mode stream pipeline", async () => {
		// Path D plan D: stream() goes through sync.request() and wraps the
		// resulting ResponseObject as SSE. The provider`s sync `response`
		// is what gets serialized, not its stream events.
		const provider = createMockProvider("wrap text");
		const sessionStore = createMockSessionStore();
		const ctx = createMockCtx(provider, sessionStore);

		const events = await readStream(
			await new ResponsesBridgeRuntime(undefined, undefined, {
				streamMode: "wrap",
			}).stream(ctx),
		);

		expect(events.at(-1)).toMatchObject({
			type: "response.completed",
			response: { id: "resp_123", output_text: "wrap text" },
		});
		expect(sessionStore.saved[0]?.id).toBe("resp_123");

		// First and last events frame the response.
		expect(events[0]?.type).toBe("response.created");
	});

	test("wrap-mode stream forces upstream to non-streaming and restores the flag", async () => {
		const ctx = {
			request: { stream: true, model: "mock/test" } as never,
		} as unknown as ResponsesContext;
		const seen: Array<{ stream: boolean | undefined }> = [];
		const bridge = new ResponsesBridgeRuntime(
			{
				request: async (receivedCtx) => {
					seen.push({
						stream: (receivedCtx.request as { stream?: boolean }).stream,
					});
					return {
						id: "resp_x",
						object: "response",
						status: "completed",
						model: "test",
						created_at: 1,
						output: [],
					} as ResponseObject;
				},
			},
			undefined,
			{ streamMode: "wrap" },
		);

		await bridge.stream(ctx);

		// During the inner sync call, stream must be false so the upstream
		// Chat Completions API returns a parseable JSON body rather than SSE.
		expect(seen).toEqual([{ stream: false }]);
		// After wrap completes, the original intent is preserved so any
		// post-wrap reader of ctx.request.stream sees what the client sent.
		expect((ctx.request as { stream: boolean | undefined }).stream).toBe(true);
	});

	test("delegates request and stream to injected pipelines", async () => {
		const ctx = { request: { stream: false } } as unknown as ResponsesContext;
		const responseObject = {
			id: "resp_injected",
			object: "response",
			status: "completed",
			model: "test",
			created_at: 1,
			output: [],
		} as ResponseObject;
		const stream = new ReadableStream<ResponseStreamEvent>();
		const calls: Array<{ pipeline: string; ctx: ResponsesContext }> = [];
		const bridge = new ResponsesBridgeRuntime(
			{
				request: async (receivedCtx) => {
					calls.push({ pipeline: "sync", ctx: receivedCtx });
					return responseObject;
				},
			},
			{
				stream: async (receivedCtx) => {
					calls.push({ pipeline: "stream", ctx: receivedCtx });
					return stream;
				},
			},
			{ streamMode: "wrap" },
		);

		const responseResult = await bridge.request(ctx);
		const streamResult = await bridge.stream(ctx);

		expect(responseResult).toBe(responseObject);
		// In wrap mode, stream() routes through the sync pipeline; the
		// stream pipeline is held in reserve for passthrough mode. The
		// stream pipeline is therefore NOT called when the runtime is in
		// its default wrap mode (it would only fire under
		// GODEX_STREAM_MODE=passthrough).
		expect(calls).toEqual([
			{ pipeline: "sync", ctx },
			{ pipeline: "sync", ctx },
		]);
		// streamResult is the wrapped SSE stream (not the injected stream).
		expect(streamResult).not.toBe(stream);
		expect(streamResult).toBeInstanceOf(ReadableStream);
	});
});
