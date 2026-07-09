import type { ResponseInputContent } from "../../protocol/openai/responses/content";
import type {
	FunctionCall,
	FunctionCallOutput,
} from "../../protocol/openai/responses/tool-items";
import { browserMcpToolName, isGodexChromeFunctionName } from "./declarations";

/**
 * Path D executor: turn a Path D `function_call` into an HTTP round-trip to
 * the chrome-browser-mcp streamable_http server (default
 * http://127.0.0.1:9224/mcp) and produce a `function_call_output` item.
 *
 * Configuration is read from the `GODEX_CHROME_MCP_URL` environment variable
 * and falls back to `http://127.0.0.1:9224/mcp`. Tests can override via
 * {@link setBrowserMcpEndpointForTesting}.
 */

const DEFAULT_BROWSER_MCP_URL = "http://127.0.0.1:9224/mcp";

let activeEndpoint: string | undefined;

export function getBrowserMcpEndpoint(): string {
	return (
		activeEndpoint ??
		process.env.GODEX_CHROME_MCP_URL ??
		DEFAULT_BROWSER_MCP_URL
	);
}

export function setBrowserMcpEndpointForTesting(url: string | undefined): void {
	activeEndpoint = url;
}

export interface McpJsonRpcResponse {
	readonly jsonrpc?: string;
	readonly id?: number | string | null;
	readonly result?: {
		readonly content?: readonly {
			readonly type?: string;
			readonly text?: string;
			readonly data?: string;
			readonly mimeType?: string;
		}[];
		readonly isError?: boolean;
	};
	readonly error?: {
		readonly code?: number;
		readonly message?: string;
	};
}

export class BrowserFunctionExecutionError extends Error {
	constructor(
		message: string,
		readonly callId: string,
		readonly providerName: string,
	) {
		super(message);
		this.name = "BrowserFunctionExecutionError";
	}
}

export function isBrowserFunctionCall(call: {
	readonly name: string;
}): boolean {
	return isGodexChromeFunctionName(call.name);
}

/**
 * Execute one Path D `function_call` against the configured chrome-browser-mcp
 * endpoint. Returns a `FunctionCallOutput` ready to be appended to the
 * Responses input so the upstream model can synthesize its next turn.
 *
 * If `call.name` is not a Path D tool, throws so the caller can decide how to
 * route the call (currently the bridge never sends non-Path-D calls here).
 */
export async function executeBrowserFunctionCall(
	call: FunctionCall,
	fetchImpl: typeof fetch = fetch,
): Promise<FunctionCallOutput> {
	if (!isBrowserFunctionCall(call)) {
		throw new BrowserFunctionExecutionError(
			`Not a browser function call: ${call.name}`,
			call.call_id,
			call.name,
		);
	}
	const mcpName = browserMcpToolName(call.name);
	if (!mcpName) {
		throw new BrowserFunctionExecutionError(
			`Unknown browser tool: ${call.name}`,
			call.call_id,
			call.name,
		);
	}

	const args = parseArguments(call.arguments);
	const payload = {
		jsonrpc: "2.0",
		id: Date.now(),
		method: "tools/call",
		params: { name: mcpName, arguments: args },
	};
	const endpoint = getBrowserMcpEndpoint();

	let response: Response;
	try {
		response = await fetchImpl(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify(payload),
		});
	} catch (err) {
		throw new BrowserFunctionExecutionError(
			`Failed to reach browser MCP server at ${endpoint}: ${errorMessage(err)}`,
			call.call_id,
			call.name,
		);
	}

	if (!response.ok) {
		throw new BrowserFunctionExecutionError(
			`Browser MCP server returned HTTP ${response.status}`,
			call.call_id,
			call.name,
		);
	}

	const body = await parseStreamableHttpBody(response);
	if (body.error) {
		throw new BrowserFunctionExecutionError(
			`Browser MCP error (${body.error.code ?? "?"}): ${body.error.message ?? "unknown"}`,
			call.call_id,
			call.name,
		);
	}
	if (body.result?.isError) {
		const text = extractText(body.result);
		throw new BrowserFunctionExecutionError(
			text || "Browser MCP reported isError=true with no text content",
			call.call_id,
			call.name,
		);
	}

	return {
		type: "function_call_output",
		call_id: call.call_id,
		status: "completed",
		output: serializeMcpResult(body.result),
	};
}

function parseArguments(argumentsJson: string): Record<string, unknown> {
	if (!argumentsJson || argumentsJson.trim() === "") return {};
	try {
		const parsed = JSON.parse(argumentsJson);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Streamable HTTP responses arrive as `event: message\ndata: {...}\n\n`. The
 * MCP SDK may also emit empty `202` responses for notifications. Parse the
 * first JSON-RPC frame and return the inner payload.
 */
async function parseStreamableHttpBody(
	response: Response,
): Promise<McpJsonRpcResponse> {
	const text = await response.text();
	if (!text.trim()) {
		throw new BrowserFunctionExecutionError(
			"Browser MCP server returned an empty body",
			"unknown",
			"unknown",
		);
	}
	for (const rawFrame of text.split(/\r?\n\r?\n/)) {
		const dataLine = rawFrame
			.split(/\r?\n/)
			.find((line) => line.startsWith("data: "));
		if (!dataLine) continue;
		const candidate = dataLine.slice("data: ".length).trim();
		if (!candidate) continue;
		try {
			return JSON.parse(candidate) as McpJsonRpcResponse;
		} catch {}
	}
	// Fallback: the body might be a plain JSON object (e.g. older chrome-browser-mcp builds).
	try {
		return JSON.parse(text) as McpJsonRpcResponse;
	} catch (err) {
		throw new BrowserFunctionExecutionError(
			`Could not parse MCP response: ${errorMessage(err)}`,
			"unknown",
			"unknown",
		);
	}
}

function extractText(result: McpJsonRpcResponse["result"]): string {
	const content = result?.content ?? [];
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block?.text === "string") parts.push(block.text);
	}
	return parts.join("\n").trim();
}

function serializeMcpResult(
	result: McpJsonRpcResponse["result"],
): string | ResponseInputContent[] {
	const content = result?.content ?? [];
	const hasImage = content.some((block) => block?.type === "image");
	const text = extractText(result);

	// Plain text: keep the legacy string path for backward compatibility.
	if (!hasImage) {
		if (text) return text;
		return JSON.stringify(content);
	}

	// Mixed or image-only results: build ResponseInputContent[] so the model
	// can actually see the image. text blocks become input_text, image blocks
	// become input_image with a data URL.
	const parts: ResponseInputContent[] = [];
	for (const block of content) {
		if (block?.type === "text" && typeof block.text === "string") {
			parts.push({ type: "input_text", text: block.text });
		} else if (
			block?.type === "image" &&
			typeof block.data === "string" &&
			block.data.length > 0
		) {
			const mime = block.mimeType ?? "image/png";
			parts.push({
				type: "input_image",
				image_url: `data:${mime};base64,${block.data}`,
			});
		}
	}
	return parts.length > 0 ? parts : "[image content returned by browser tool]";
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
