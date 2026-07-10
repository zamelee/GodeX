import { describe, expect, test } from "bun:test";
import { MESSAGES_PROTOCOL, X_API_KEY_AUTH } from "../../bridge/provider-spec";
import {
	createMiniMaxAnthropicSpec,
	MINIMAX_ANTHROPIC_DEFAULT_BASE_URL,
	MINIMAX_ANTHROPIC_DEFAULT_MODEL,
	MINIMAX_ANTHROPIC_PROVIDER_NAME,
	MINIMAX_ANTHROPIC_SPEC,
} from "./spec";

describe("minimax-anthropic provider spec (Phase B5)", () => {
	test("singleton spec carries the expected identity", () => {
		expect(MINIMAX_ANTHROPIC_SPEC.name).toBe(MINIMAX_ANTHROPIC_PROVIDER_NAME);
		expect(MINIMAX_ANTHROPIC_SPEC.name).toBe("minimax-anthropic");
		expect(MINIMAX_ANTHROPIC_SPEC.protocol).toBe(MESSAGES_PROTOCOL);
		expect(MINIMAX_ANTHROPIC_SPEC.auth).toEqual(X_API_KEY_AUTH);
		expect(MINIMAX_ANTHROPIC_SPEC.endpoint.defaultBaseURL).toBe(
			MINIMAX_ANTHROPIC_DEFAULT_BASE_URL,
		);
		expect(MINIMAX_ANTHROPIC_SPEC.endpoint.defaultBaseURL).toBe(
			"https://minnimax.chat",
		);
		expect(MINIMAX_ANTHROPIC_SPEC.streamMode).toBe("passthrough");
		expect(MINIMAX_ANTHROPIC_DEFAULT_MODEL).toBe("claude-3-5-sonnet-20241022");
	});

	test("singleton and factory specs are independent codec instances", () => {
		const a = createMiniMaxAnthropicSpec();
		const b = createMiniMaxAnthropicSpec();
		expect(a.toolName).not.toBe(b.toolName);
		expect(a.toolName).not.toBe(MINIMAX_ANTHROPIC_SPEC.toolName);

		// Encoding the same name through different instances should still
		// produce the same sanitized result because the codec is deterministic.
		expect(a.toolName.toProviderName("foo.bar")).toBe("foo_bar");
		expect(b.toolName.toProviderName("foo.bar")).toBe("foo_bar");
		expect(MINIMAX_ANTHROPIC_SPEC.toolName.toProviderName("foo.bar")).toBe(
			"foo_bar",
		);
	});

	test("capabilities match Anthropic (thin wrapper reuses capabilities map)", () => {
		const cap = MINIMAX_ANTHROPIC_SPEC.capabilities;
		expect(cap.parameters.supported.has("thinking")).toBe(true);
		expect(cap.parameters.supported.has("metadata")).toBe(true);
		expect(cap.toolChoice.supported.has("any")).toBe(true);
		expect(cap.toolChoice.supported.has("auto")).toBe(true);
		expect(cap.toolChoice.supported.has("none")).toBe(true);
		expect(cap.toolChoice.supported.has("tool")).toBe(true);
		expect(cap.reasoning.effort).toBe("native");
		expect(cap.streaming.usage).toBe(true);
		expect(cap.tools.supported.has("function")).toBe(true);
		expect(cap.tools.supported.has("web_search")).toBe(true);
		expect(cap.tools.degraded?.get("apply_patch")).toBe("function");
		expect(cap.tools.degraded?.get("local_shell")).toBe("function");
		expect(cap.tools.degraded?.get("namespace")).toBe("function");
	});

	test("response accessors produce Anthropic-compatible output", () => {
		const textOnly = {
			id: "msg_t",
			type: "message" as const,
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "hi" }],
			model: "claude-3-5-sonnet-20241022",
			stop_reason: "end_turn" as const,
			stop_sequence: null,
			usage: { input_tokens: 3, output_tokens: 7 },
		};

		expect(MINIMAX_ANTHROPIC_SPEC.response.firstChoice(textOnly)).toEqual({
			message: { tool_calls: [] },
		});
		expect(MINIMAX_ANTHROPIC_SPEC.response.finishReason(textOnly)).toBe("stop");
		expect(MINIMAX_ANTHROPIC_SPEC.response.outputText(textOnly)).toBe("hi");
		expect(
			MINIMAX_ANTHROPIC_SPEC.response.reasoningText!(textOnly),
		).toBeUndefined();
		expect(MINIMAX_ANTHROPIC_SPEC.response.usage(textOnly)).toEqual({
			input_tokens: 3,
			output_tokens: 7,
			total_tokens: 10,
		});
	});

	test("factory spec has independent codec from singleton", () => {
		const a = createMiniMaxAnthropicSpec();
		const b = createMiniMaxAnthropicSpec();
		// Each instance keeps its own reverse map, so encoding a name
		// through one factory spec does not affect the other.
		const fromA = a.toolName.toProviderName("session.isolated");
		const fromB = b.toolName.toProviderName("session.isolated");
		expect(typeof fromA).toBe("string");
		expect(typeof fromB).toBe("string");
		expect(a.toolName).not.toBe(b.toolName);
	});
});
