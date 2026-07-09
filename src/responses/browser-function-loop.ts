import type { ResponsesContext } from "../context/responses-context";
import type {
	FunctionCall,
	FunctionCallOutput,
	ResponseItem,
	ResponseObject,
} from "../protocol/openai/responses";
import {
	executeBrowserFunctionCall,
	isBrowserFunctionCall,
} from "../tools/browser-function-tools";
import type { ResponsesSyncPipeline } from "./runtime";

const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Path D agentic loop: when the upstream model emits a `function_call` whose
 * name is a Path D browser tool (`godex_chrome_*`), execute it locally
 * against the configured chrome-browser-mcp server and feed the result back
 * to the upstream as a `function_call_output` item. Repeat until the model
 * produces a final response without a browser tool call.
 *
 * The loop is layered on top of {@link ResponsesSyncPipeline} so the existing
 * pipeline (request building, tool planning, output reconstruction, session
 * persistence) is unchanged. Each round reuses the same `ctx` and mutates
 * `ctx.request.input` to grow the conversation history with the freshly
 * executed `function_call` + `function_call_output` pair.
 */
export class BrowserFunctionLoop implements ResponsesSyncPipeline {
	private readonly inner: ResponsesSyncPipeline;
	private readonly maxIterations: number;

	constructor(
		inner: ResponsesSyncPipeline,
		maxIterations = DEFAULT_MAX_ITERATIONS,
	) {
		this.inner = inner;
		this.maxIterations = maxIterations;
	}

	async request(ctx: ResponsesContext): Promise<ResponseObject> {
		const accumulated: ResponseItem[] = [];
		let response: ResponseObject | null = null;

		for (let iteration = 0; iteration <= this.maxIterations; iteration++) {
			response = await this.inner.request(ctx);
			const browserCalls = extractBrowserFunctionCalls(response);

			if (browserCalls.length === 0) {
				return mergeAccumulated(response, accumulated);
			}

			ctx.logger.info("browser.function.loop.iteration", () => ({
				request_id: ctx.requestId,
				iteration,
				browserCalls: browserCalls.map((call) => ({
					call_id: call.call_id,
					name: call.name,
				})),
			}));

			const outputs: FunctionCallOutput[] = [];
			for (const call of browserCalls) {
				outputs.push(await runBrowserCall(call, ctx));
			}

			accumulated.push(...withCompletedStatus(browserCalls), ...outputs);

			appendItemsToInput(ctx, browserCalls, outputs);
		}

		ctx.logger.warn("browser.function.loop.exhausted", () => ({
			request_id: ctx.requestId,
			maxIterations: this.maxIterations,
		}));
		return mergeAccumulated(response as unknown as ResponseObject, accumulated);
	}
}

function extractBrowserFunctionCalls(response: ResponseObject): FunctionCall[] {
	return response.output.filter(
		(item): item is FunctionCall =>
			item.type === "function_call" && isBrowserFunctionCall(item),
	);
}

async function runBrowserCall(
	call: FunctionCall,
	ctx: ResponsesContext,
): Promise<FunctionCallOutput> {
	try {
		const output = await executeBrowserFunctionCall(call);
		ctx.logger.debug("browser.function.executed", () => ({
			call_id: call.call_id,
			name: call.name,
			status: "completed",
		}));
		return output;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.logger.warn("browser.function.error", () => ({
			call_id: call.call_id,
			name: call.name,
			error: message,
		}));
		return {
			type: "function_call_output",
			call_id: call.call_id,
			status: "completed",
			output: `Error: ${message}`,
		};
	}
}

function withCompletedStatus(calls: readonly FunctionCall[]): FunctionCall[] {
	return calls.map((call) => ({
		...call,
		status: "completed" as const,
	}));
}

function appendItemsToInput(
	ctx: ResponsesContext,
	calls: readonly FunctionCall[],
	outputs: readonly FunctionCallOutput[],
): void {
	const request = ctx.request;
	const items: ResponseItem[] = [...calls, ...outputs];
	if (request.input === undefined) {
		request.input = items;
		return;
	}
	if (typeof request.input === "string") {
		request.input = [
			{ type: "message", role: "user", content: request.input },
			...items,
		];
		return;
	}
	request.input = [...request.input, ...items];
}

function mergeAccumulated(
	finalResponse: ResponseObject,
	accumulated: readonly ResponseItem[],
): ResponseObject {
	if (accumulated.length === 0) return finalResponse;
	return {
		...finalResponse,
		output: [...accumulated, ...finalResponse.output],
	};
}
