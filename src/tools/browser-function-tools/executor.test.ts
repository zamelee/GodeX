import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FunctionCall } from "../../protocol/openai/responses/tool-items";
import { browserMcpToolName, isGodexChromeFunctionName } from "./declarations";
import {
	BrowserFunctionExecutionError,
	executeBrowserFunctionCall,
	isBrowserFunctionCall,
	setBrowserMcpEndpointForTesting,
} from "./executor";

// A loose fetch stub type that matches what the executor expects.
type FetchStub = (input: string | URL, init?: RequestInit) => Promise<Response>;

const baseCall: FunctionCall = {
	type: "function_call",
	call_id: "call_xyz",
	name: "godex_chrome_list_pages",
	arguments: "{}",
};

describe("declarations", () => {
	test("recognizes Path D prefix", () => {
		expect(isGodexChromeFunctionName("godex_chrome_list_pages")).toBe(true);
		expect(isGodexChromeFunctionName("godex_chrome_navigate")).toBe(true);
		expect(isGodexChromeFunctionName("chrome_list_pages")).toBe(false);
		expect(isGodexChromeFunctionName("mcp__chrome_devtools__list_pages")).toBe(
			false,
		);
	});

	test("maps provider name to MCP tool name", () => {
		expect(browserMcpToolName("godex_chrome_list_pages")).toBe("list_pages");
		expect(browserMcpToolName("godex_chrome_navigate")).toBe("navigate");
		expect(browserMcpToolName("godex_chrome_screenshot")).toBe("screenshot");
		expect(browserMcpToolName("chrome_list_pages")).toBeUndefined();
	});
});

describe("isBrowserFunctionCall", () => {
	test("returns true for Path D calls", () => {
		expect(isBrowserFunctionCall({ name: "godex_chrome_list_pages" })).toBe(
			true,
		);
	});
	test("returns false for other tool calls", () => {
		expect(isBrowserFunctionCall({ name: "get_weather" })).toBe(false);
	});
});

describe("executeBrowserFunctionCall", () => {
	let previousEndpoint: string | undefined;

	beforeEach(() => {
		previousEndpoint = process.env.GODEX_CHROME_MCP_URL;
		delete process.env.GODEX_CHROME_MCP_URL;
		setBrowserMcpEndpointForTesting("http://mcp.test/mcp");
	});

	afterEach(() => {
		setBrowserMcpEndpointForTesting(undefined);
		if (previousEndpoint === undefined) {
			delete process.env.GODEX_CHROME_MCP_URL;
		} else {
			process.env.GODEX_CHROME_MCP_URL = previousEndpoint;
		}
	});

	function sseResponse(payload: unknown, status = 200): Response {
		const json = JSON.stringify(payload);
		const body = `event: message\ndata: ${json}\n\n`;
		return new Response(body, {
			status,
			headers: { "Content-Type": "text/event-stream" },
		});
	}

	test("returns function_call_output for a successful text result", async () => {
		const fetchImpl: FetchStub = async () =>
			sseResponse({
				jsonrpc: "2.0",
				id: 1,
				result: {
					content: [
						{
							type: "text",
							text: '[{"id":"a","url":"https://example.com","title":"Example Domain"}]',
						},
					],
				},
			});

		const out = await executeBrowserFunctionCall(
			baseCall,
			fetchImpl as unknown as typeof fetch,
		);

		expect(out.type).toBe("function_call_output");
		expect(out.call_id).toBe("call_xyz");
		expect(out.status).toBe("completed");
		expect(out.output).toContain("Example Domain");
	});

	test("rewrites the call name from Path D to MCP tool name", async () => {
		let captured: { url: string; init?: RequestInit } | null | undefined;
		const fetchImpl: FetchStub = async (input, init) => {
			captured = { url: String(input), init };
			return sseResponse({
				jsonrpc: "2.0",
				id: 1,
				result: { content: [{ type: "text", text: "ok" }] },
			});
		};

		await executeBrowserFunctionCall(
			{
				type: "function_call",
				call_id: "c1",
				name: "godex_chrome_navigate",
				arguments: '{"url":"https://example.com"}',
			},
			fetchImpl as unknown as typeof fetch,
		);

		const cap = captured as unknown as { url: string; init?: RequestInit };
		const body = JSON.parse(String(cap.init?.body));
		expect(cap.url).toBe("http://mcp.test/mcp");
		expect(body.params.name).toBe("navigate");
		expect(body.params.arguments).toEqual({ url: "https://example.com" });
	});

	test("throws BrowserFunctionExecutionError when result.isError is true", async () => {
		const fetchImpl: FetchStub = async () =>
			sseResponse({
				jsonrpc: "2.0",
				id: 1,
				result: {
					isError: true,
					content: [{ type: "text", text: "boom" }],
				},
			});

		await expect(
			executeBrowserFunctionCall(
				baseCall,
				fetchImpl as unknown as typeof fetch,
			),
		).rejects.toThrow(BrowserFunctionExecutionError);
	});

	test("throws when the server returns a JSON-RPC error", async () => {
		const fetchImpl: FetchStub = async () =>
			sseResponse({
				jsonrpc: "2.0",
				id: 1,
				error: { code: -32000, message: "internal" },
			});

		await expect(
			executeBrowserFunctionCall(
				baseCall,
				fetchImpl as unknown as typeof fetch,
			),
		).rejects.toThrow(/Browser MCP error/);
	});

	test("throws when the HTTP status is not OK", async () => {
		const fetchImpl: FetchStub = async () =>
			new Response("nope", { status: 502 });

		await expect(
			executeBrowserFunctionCall(
				baseCall,
				fetchImpl as unknown as typeof fetch,
			),
		).rejects.toThrow(/HTTP 502/);
	});

	test("falls back to plain JSON body when no SSE frame is present", async () => {
		const fetchImpl: FetchStub = async () =>
			new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: { content: [{ type: "text", text: "fallback-ok" }] },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);

		const out = await executeBrowserFunctionCall(
			baseCall,
			fetchImpl as unknown as typeof fetch,
		);
		expect(out.output).toBe("fallback-ok");
	});

	test("returns image content parts when result is image-only", async () => {
		const fetchImpl: FetchStub = async () =>
			sseResponse({
				jsonrpc: "2.0",
				id: 1,
				result: {
					content: [
						{ type: "image", data: "BASE64DATA", mimeType: "image/png" },
					],
				},
			});

		const out = await executeBrowserFunctionCall(
			baseCall,
			fetchImpl as unknown as typeof fetch,
		);
		expect(Array.isArray(out.output)).toBe(true);
		const parts = out.output as Array<{
			type: string;
			image_url?: string;
			text?: string;
		}>;
		expect(parts).toHaveLength(1);
		expect(parts[0]!.type).toBe("input_image");
		expect(parts[0]!.image_url).toBe("data:image/png;base64,BASE64DATA");
	});

	test("returns mixed text and image content parts", async () => {
		const fetchImpl: FetchStub = async () =>
			sseResponse({
				jsonrpc: "2.0",
				id: 1,
				result: {
					content: [
						{ type: "text", text: "PNG bytes below:" },
						{ type: "image", data: "AAAA", mimeType: "image/jpeg" },
					],
				},
			});

		const out = await executeBrowserFunctionCall(
			baseCall,
			fetchImpl as unknown as typeof fetch,
		);
		expect(Array.isArray(out.output)).toBe(true);
		const parts = out.output as Array<{
			type: string;
			image_url?: string;
			text?: string;
		}>;
		expect(parts).toHaveLength(2);
		expect(parts[0]).toEqual({ type: "input_text", text: "PNG bytes below:" });
		expect(parts[1]!.type).toBe("input_image");
		expect(parts[1]!.image_url).toBe("data:image/jpeg;base64,AAAA");
	});

	test("uses image/png default mime when mimeType is missing", async () => {
		const fetchImpl: FetchStub = async () =>
			sseResponse({
				jsonrpc: "2.0",
				id: 1,
				result: {
					content: [{ type: "image", data: "XYZ" }],
				},
			});

		const out = await executeBrowserFunctionCall(
			baseCall,
			fetchImpl as unknown as typeof fetch,
		);
		const parts = out.output as Array<{ type: string; image_url?: string }>;
		expect(parts[0]!.image_url).toBe("data:image/png;base64,XYZ");
	});
});
