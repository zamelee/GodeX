import { describe, expect, test } from "bun:test";
import type { ChatCompletionCreateRequest as BridgeRequest } from "../../protocol/openai/completions";
import { minimaxPatchRequest, minimaxStreamDeltas } from "./hooks";
import type { ChatCompletionChunk } from "./protocol";

function bridgeRequest(overrides: Partial<BridgeRequest> = {}): BridgeRequest {
	return {
		model: "MiniMax-M3",
		messages: [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hi" },
		],
		...overrides,
	} as BridgeRequest;
}

function toRecord(value: unknown): Record<string, unknown> {
	return value as Record<string, unknown>;
}

describe("minimaxPatchRequest", () => {
	test("sets reasoning_split to true", () => {
		const result = minimaxPatchRequest(bridgeRequest());
		expect(result.reasoning_split).toBe(true);
	});

	test("preserves reasoning_content on assistant messages", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				messages: [
					{ role: "user", content: "Hi" },
					{
						role: "assistant",
						content: "Hello!",
						reasoning_content: "The user is greeting me.",
					},
					{ role: "user", content: "What is 1+1?" },
				],
			} as unknown as BridgeRequest),
		);

		const assistant = toRecord(result.messages[1]);
		expect(assistant.reasoning_content).toBe("The user is greeting me.");
		expect("reasoning_details" in assistant).toBe(false);
		expect(assistant.content).toBe("Hello!");
	});

	test("maps bridge thinking enabled to MiniMax adaptive thinking", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				thinking: { type: "enabled" },
			} as unknown as BridgeRequest),
		);

		expect(toRecord(result).thinking).toEqual({ type: "adaptive" });
	});

	test("preserves bridge thinking disabled", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				thinking: { type: "disabled" },
			} as unknown as BridgeRequest),
		);

		expect(toRecord(result).thinking).toEqual({ type: "disabled" });
	});

	test("preserves assistant messages without reasoning_content unchanged", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				messages: [
					{ role: "user", content: "Hi" },
					{ role: "assistant", content: "Hello!" },
				],
			} as unknown as BridgeRequest),
		);

		const assistant = toRecord(result.messages[1]);
		expect(assistant).toEqual({ role: "assistant", content: "Hello!" });
	});

	test("does not touch non-assistant messages", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				messages: [
					{ role: "system", content: "Be helpful." },
					{ role: "user", content: "Hi" },
					{
						role: "tool" as const,
						tool_call_id: "call_1",
						content: "result",
					},
				],
			} as unknown as BridgeRequest),
		);

		expect(toRecord(result.messages[0])).toEqual({
			role: "system",
			content: "Be helpful.",
		});
		expect(toRecord(result.messages[1])).toEqual({
			role: "user",
			content: "Hi",
		});
		expect(toRecord(result.messages[2])).toEqual({
			role: "tool",
			tool_call_id: "call_1",
			content: "result",
		});
	});

	test("converts max_tokens to max_completion_tokens", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({ max_tokens: 100 } as unknown as BridgeRequest),
		);
		expect(toRecord(result).max_completion_tokens).toBe(100);
		expect("max_tokens" in result).toBe(false);
	});

	test("canonicalizes assistant tool_call arguments", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				messages: [
					{ role: "user", content: "lookup" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_x",
								type: "function",
								function: {
									name: "lookup",
									arguments: '{ "city" : "Hangzhou" , "unit" :  "c" }',
								},
							},
						],
					} as never,
				],
			} as unknown as BridgeRequest),
		);

		const assistant = toRecord(result.messages[1]);
		const toolCalls = assistant.tool_calls as Array<Record<string, unknown>>;
		expect(toolCalls[0]).toBeDefined();
		const toolCall = toolCalls[0] as Record<string, unknown>;
		const fn = toolCall.function as Record<string, unknown>;
		expect(JSON.parse(fn.arguments as string)).toEqual({
			city: "Hangzhou",
			unit: "c",
		});
		expect((fn.arguments as string).includes("  ")).toBe(false);
	});

	test("keeps non-function tool call types untouched", () => {
		const result = minimaxPatchRequest(
			bridgeRequest({
				messages: [
					{ role: "user", content: "x" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_x",
								type: "custom",
								custom: { name: "raw" },
								function: { name: "raw", arguments: "{not-json" },
							},
						],
					} as never,
				],
			} as unknown as BridgeRequest),
		);

		const assistant = toRecord(result.messages[1]);
		const toolCalls = assistant.tool_calls as Array<Record<string, unknown>>;
		expect(toolCalls[0]).toBeDefined();
		const toolCall = toolCalls[0] as Record<string, unknown>;
		const fn = toolCall.function as Record<string, unknown>;
		expect(fn.arguments).toBe("{not-json");
	});
});

describe("minimaxStreamDeltas", () => {
	test("maps reasoning_content to reasoning deltas", () => {
		const chunk: ChatCompletionChunk = {
			choices: [
				{
					index: 0,
					delta: {
						reasoning_content: "Let me think...",
					},
				},
			],
		};

		const deltas = minimaxStreamDeltas(chunk);
		expect(deltas).toEqual([{ reasoning: "Let me think..." }]);
	});

	test("maps reasoning_content before content when both arrive together", () => {
		const chunk: ChatCompletionChunk = {
			choices: [
				{
					index: 0,
					delta: {
						content: '{"ok":true}',
						reasoning_content: "thinking",
					},
				},
			],
		};

		const deltas = minimaxStreamDeltas(chunk);
		expect(deltas).toEqual([
			{ reasoning: "thinking" },
			{ text: '{"ok":true}' },
		]);
	});
});
