import { describe, expect, test } from "bun:test";
import { MESSAGES_PROTOCOL, X_API_KEY_AUTH } from "../../bridge/provider-spec";
import type { AnthropicMessagesResponse } from "./protocol";
import {
	ANTHROPIC_DEFAULT_BASE_URL,
	ANTHROPIC_DEFAULT_MODEL,
	ANTHROPIC_MESSAGES_SPEC,
	ANTHROPIC_PROVIDER_NAME,
	createAnthropicSpec,
} from "./spec";

describe("Anthropic provider spec (Phase B3.2)", () => {
	test("singleton spec carries the expected identity", () => {
		expect(ANTHROPIC_MESSAGES_SPEC.name).toBe(ANTHROPIC_PROVIDER_NAME);
		expect(ANTHROPIC_MESSAGES_SPEC.name).toBe("anthropic");
		expect(ANTHROPIC_MESSAGES_SPEC.protocol).toBe(MESSAGES_PROTOCOL);
		expect(ANTHROPIC_MESSAGES_SPEC.auth).toEqual(X_API_KEY_AUTH);
		expect(ANTHROPIC_MESSAGES_SPEC.endpoint.defaultBaseURL).toBe(
			ANTHROPIC_DEFAULT_BASE_URL,
		);
		expect(ANTHROPIC_MESSAGES_SPEC.endpoint.defaultBaseURL).toBe(
			"https://api.anthropic.com",
		);
		expect(ANTHROPIC_MESSAGES_SPEC.streamMode).toBe("passthrough");
		expect(ANTHROPIC_DEFAULT_MODEL).toBe("claude-3-5-sonnet-20241022");
	});

	test("singleton and factory specs are independent codec instances", () => {
		const a = createAnthropicSpec();
		const b = createAnthropicSpec();
		expect(a.toolName).not.toBe(b.toolName);
		expect(a.toolName).not.toBe(ANTHROPIC_MESSAGES_SPEC.toolName);

		// Encoding the same name through different instances should still
		// produce the same sanitized result because the codec is deterministic.
		expect(a.toolName.toProviderName("foo.bar")).toBe("foo_bar");
		expect(b.toolName.toProviderName("foo.bar")).toBe("foo_bar");
		expect(ANTHROPIC_MESSAGES_SPEC.toolName.toProviderName("foo.bar")).toBe(
			"foo_bar",
		);
	});

	test("capabilities declare Anthropic-native feature set", () => {
		const cap = ANTHROPIC_MESSAGES_SPEC.capabilities;
		expect(cap.parameters.supported.has("thinking")).toBe(true);
		expect(cap.parameters.supported.has("metadata")).toBe(true);
		expect(cap.toolChoice.supported.has("any")).toBe(true);
		expect(cap.toolChoice.supported.has("auto")).toBe(true);
		expect(cap.toolChoice.supported.has("none")).toBe(true);
		expect(cap.toolChoice.supported.has("tool")).toBe(true);
		expect(cap.reasoning.effort).toBe("native");
		expect(cap.streaming.usage).toBe(true);
		// Codex tool types Anthropic can express natively:
		expect(cap.tools.supported.has("function")).toBe(true);
		expect(cap.tools.supported.has("web_search")).toBe(true);
		// Codex tool types that need degradation:
		expect(cap.tools.degraded?.get("apply_patch")).toBe("function");
		expect(cap.tools.degraded?.get("local_shell")).toBe("function");
		expect(cap.tools.degraded?.get("namespace")).toBe("function");
	});

	test("response accessors wired in B4 (translate Anthropic stop_reason + content blocks)", () => {
		const textOnly = {
			id: "msg_t",
			type: "message" as const,
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "hi" }],
			model: "claude-3-5-sonnet-20241022",
			stop_reason: "end_turn" as const,
			stop_sequence: null,
			usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 4 },
		};

		// Text-only response: firstChoice defined shape, empty tool_calls.
		expect(ANTHROPIC_MESSAGES_SPEC.response.firstChoice(textOnly)).toEqual({
			message: { tool_calls: [] },
		});
		// finishReason translates Anthropic stop_reason end_turn -> stop.
		expect(ANTHROPIC_MESSAGES_SPEC.response.finishReason(textOnly)).toBe(
			"stop",
		);
		// outputText joins text blocks; reasoningText undefined when no thinking.
		expect(ANTHROPIC_MESSAGES_SPEC.response.outputText(textOnly)).toBe("hi");
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.reasoningText!(textOnly),
		).toBeUndefined();

		// Tool-use response: firstChoice synthesizes Chat-shape tool_calls from tool_use blocks.
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_01",
			name: "get_weather",
			input: { city: "Tokyo" },
		};
		const withTool = {
			id: "msg_u",
			type: "message" as const,
			role: "assistant" as const,
			content: [toolUseBlock],
			model: "claude-3-5-sonnet-20241022",
			stop_reason: "tool_use" as const,
			stop_sequence: null,
			usage: { input_tokens: 3, output_tokens: 7 },
		};
		const fc = ANTHROPIC_MESSAGES_SPEC.response.firstChoice(withTool) as
			| {
					message: {
						tool_calls: {
							id: string;
							type: string;
							function: { name: string; arguments: string };
						}[];
					};
			  }
			| undefined;
		expect(fc?.message.tool_calls).toEqual([
			{
				id: "toolu_01",
				type: "function",
				function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
			},
		]);
		expect(ANTHROPIC_MESSAGES_SPEC.response.finishReason(withTool)).toBe(
			"tool_calls",
		);

		// Thinking block surfaces as reasoning text.
		const withThink = {
			id: "msg_k",
			type: "message" as const,
			role: "assistant" as const,
			content: [{ type: "thinking" as const, thinking: "deep thought" }],
			model: "claude-3-5-sonnet-20241022",
			stop_reason: "end_turn" as const,
			stop_sequence: null,
			usage: { input_tokens: 3, output_tokens: 7 },
		};
		expect(ANTHROPIC_MESSAGES_SPEC.response.reasoningText!(withThink)).toBe(
			"deep thought",
		);

		// stop_reason translation covers all four Anthropic values + null/undefined.
		const base = {
			id: "x",
			type: "message" as const,
			stop_reason: "end_turn" as const,
			role: "assistant" as const,
			content: [],
			model: "m",
			usage: { input_tokens: 0, output_tokens: 0 },
		};
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.finishReason({
				...base,
				stop_reason: "end_turn",
			}),
		).toBe("stop");
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.finishReason({
				...base,
				stop_reason: "tool_use",
			}),
		).toBe("tool_calls");
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.finishReason({
				...base,
				stop_reason: "max_tokens",
			}),
		).toBe("length");
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.finishReason({
				...base,
				stop_reason: "stop_sequence",
			}),
		).toBe("stop");
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.finishReason({
				...base,
				stop_reason: null,
			}),
		).toBeUndefined();
		// base already carries stop_reason: end_turn so finishReason translates to stop.
		// Test the undefined case with a base that omits stop_reason entirely.
		const baseNoStop = {
			id: "x",
			type: "message" as const,
			role: "assistant" as const,
			content: [],
			model: "m",
			usage: { input_tokens: 0, output_tokens: 0 },
		} as unknown as AnthropicMessagesResponse;
		expect(
			ANTHROPIC_MESSAGES_SPEC.response.finishReason(baseNoStop),
		).toBeUndefined();

		// usage normalizes AnthropicUsage -> ResponseUsage with total_tokens + cached_tokens.
		expect(ANTHROPIC_MESSAGES_SPEC.response.usage(textOnly)).toEqual({
			input_tokens: 3,
			output_tokens: 7,
			total_tokens: 10,
			input_tokens_details: { cached_tokens: 4 },
		});

		// Empty content yields undefined firstChoice (response-reconstructor surfaces failed).
		const empty = {
			id: "msg_e",
			type: "message" as const,
			role: "assistant" as const,
			content: [],
			model: "claude-3-5-sonnet-20241022",
			stop_reason: "end_turn" as const,
			usage: { input_tokens: 1, output_tokens: 1 },
		};
		expect(ANTHROPIC_MESSAGES_SPEC.response.firstChoice(empty)).toBeUndefined();
	});
	test("patchRequest hook is an identity transform in B3.2", () => {
		const req = {
			model: "claude-3-5-sonnet-20241022",
			messages: [{ role: "user" as const, content: "hi" }],
			max_tokens: 1024,
		};
		const patched = ANTHROPIC_MESSAGES_SPEC.hooks?.patchRequest?.(req);
		expect(patched).toBe(req);
	});
});
