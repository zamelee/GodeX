import { describe, expect, test } from "bun:test";
import type { CompatibilityDiagnostic } from "../bridge/compatibility";
import type {
	ProviderEdge,
	ProviderSpec,
} from "../bridge/provider-spec/contract";
import {
	type BuildBridgeRequestResult,
	buildBridgeRequest,
} from "../bridge/request";
import { createToolPlanningProfile } from "../bridge/tools";
import { OutputContractSlot } from "../context/output-contract-slot";
import type { ResponsesContext } from "../context/responses-context";
import type { ResponseObject } from "../protocol/openai/responses";
import type { ResponseSessionStore } from "../session";
import {
	completedTextResponse,
	createTestProviderEdge,
	type TestChatResponse,
} from "../testing/provider-edge";
import { BrowserFunctionLoop } from "./browser-function-loop";
import type { ProviderRequestExchangeResult } from "./provider-exchange";
import { SyncRequestPipeline } from "./sync-request-pipeline";

function makeCtx(
	provider: ProviderEdge<unknown, unknown, unknown>,
): ResponsesContext {
	const sessionStore = createMockSessionStore();
	return {
		provider,
		app: {
			sessionStore,
			traceEnabled: false,
			traceRecorder: { record: () => {} },
			plugins: [],
			config: {},
			search: { available: false },
		},
		logger: {
			info: () => {},
			debug: () => {},
			trace: () => {},
			error: () => {},
			warn: () => {},
		} as unknown as ResponsesContext["logger"],
		request: {
			model: "mock/test",
			input: "list my tabs",
			store: false,
		},
		requestId: "req_loop",
		responseId: "resp_loop",
		createdAt: Math.floor(Date.now() / 1000),
		resolved: { provider: "mock", model: "test" },
		diagnostics: [],
		addDiagnostic(_d: CompatibilityDiagnostic) {},
		attributes: new Map(),
		outputContract: new OutputContractSlot(),
		session: null,
	} as unknown as ResponsesContext;
}

function createMockSessionStore(): ResponseSessionStore {
	return {
		get: async () => null,
		save: async () => {},
		resolveChain: async () =>
			({ previous_response_id: "none", turns: [], input_items: [] }) as never,
		delete: async () => {},
	} as unknown as ResponseSessionStore;
}

function toolCallResponse(
	id: string,
	name: string,
	args: object,
): TestChatResponse {
	return {
		choices: [
			{
				message: {
					content: null,
					tool_calls: [
						{
							id,
							type: "function",
							function: { name, arguments: JSON.stringify(args) },
						},
					],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
	};
}

async function createExchangeResult(
	ctx: ResponsesContext,
	providerResponse: TestChatResponse,
): Promise<ProviderRequestExchangeResult> {
	const built: BuildBridgeRequestResult = await buildBridgeRequest({
		request: ctx.request,
		provider: ctx.provider.name,
		model: ctx.resolved.model,
		spec: specOf(ctx.provider),
		profile: createToolPlanningProfile({
			provider: ctx.provider.name,
			capabilities: specOf(ctx.provider).capabilities,
			toProviderName: ctx.provider.spec.toolName.toProviderName,
		}),
		session: ctx.session,
	});
	ctx.outputContract.set(built.output);
	return { providerResponse, built };
}

function specOf(
	provider: ProviderEdge<unknown, unknown, unknown>,
): ProviderSpec<unknown, unknown, unknown> {
	return provider.spec;
}

/**
 * Build a `SyncRequestPipeline` whose underlying exchange can be replaced
 * per round. The agentic loop wraps the real pipeline, which means tool
 * restoration, output reconstruction, and output contract validation all
 * run normally.
 */
function makePipeline(
	replacement: (round: number) => Promise<TestChatResponse>,
): { pipeline: SyncRequestPipeline; callCount: () => number } {
	let calls = 0;
	const exchange = {
		request: async (
			ctx: ResponsesContext,
		): Promise<ProviderRequestExchangeResult> => {
			calls += 1;
			const r = await replacement(calls);
			return await createExchangeResult(ctx, r);
		},
	};
	const saveSession = async () => {};
	return {
		pipeline: new SyncRequestPipeline(exchange, saveSession),
		callCount: () => calls,
	};
}

describe("BrowserFunctionLoop", () => {
	test("returns inner response when no browser function calls are emitted", async () => {
		const provider = createTestProviderEdge({
			name: "mock",
			response: completedTextResponse("hello", {
				input_tokens: 1,
				output_tokens: 1,
				total_tokens: 2,
			}),
		});
		const ctx = makeCtx(provider);
		const { pipeline, callCount } = makePipeline(async () =>
			completedTextResponse("hello", {
				input_tokens: 1,
				output_tokens: 1,
				total_tokens: 2,
			}),
		);
		const result = await new BrowserFunctionLoop(pipeline).request(ctx);
		expect(result.output_text).toBe("hello");
		expect(callCount()).toBe(1);
	});

	test("does not loop on non-Path D function calls", async () => {
		const provider = createTestProviderEdge({
			name: "mock",
			response: toolCallResponse("call_other", "get_weather", {}),
		});
		const ctx = makeCtx(provider);
		const { pipeline, callCount } = makePipeline(async () =>
			toolCallResponse("call_other", "get_weather", {}),
		);
		const result: ResponseObject = await new BrowserFunctionLoop(
			pipeline,
		).request(ctx);
		expect(callCount()).toBe(1);
		expect(
			result.output.some(
				(o) => o.type === "function_call" && o.name === "get_weather",
			),
		).toBe(true);
	});

	test("converts string input to item array before appending function calls", async () => {
		const provider = createTestProviderEdge({
			name: "mock",
			response: toolCallResponse("call_x", "godex_chrome_list_pages", {}),
		});
		const ctx = makeCtx(provider);
		ctx.request.input = "what tabs are open?";

		// Use an exchange that fails fast on the second call so we can verify
		// the input transformation without hitting the real chrome-browser-mcp
		// backend.
		let calls = 0;
		const exchange = {
			request: async (
				c: ResponsesContext,
			): Promise<ProviderRequestExchangeResult> => {
				calls += 1;
				if (calls === 1) {
					return await createExchangeResult(
						c,
						toolCallResponse("call_x", "godex_chrome_list_pages", {}),
					);
				}
				throw new Error("stop after first round");
			},
		};
		const saveSession = async () => {};
		const pipeline = new SyncRequestPipeline(exchange, saveSession);

		await expect(
			new BrowserFunctionLoop(pipeline).request(ctx),
		).rejects.toThrow("stop after first round");
		expect(Array.isArray(ctx.request.input)).toBe(true);
		if (Array.isArray(ctx.request.input)) {
			const first = ctx.request.input[0] as {
				type?: string;
				role?: string;
				content?: string;
			};
			expect(first.type).toBe("message");
			expect(first.role).toBe("user");
			expect(first.content).toBe("what tabs are open?");
		}
	});
});
