import { describe, expect, test } from "bun:test";
import { MESSAGES_PROTOCOL, X_API_KEY_AUTH } from "../../bridge/provider-spec";
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

	test("response accessor stubs return safe defaults until B4 fills them", () => {
		const stub = {
			id: "msg_x",
			type: "message" as const,
			role: "assistant" as const,
			content: [],
			model: "claude-3-5-sonnet-20241022",
			stop_reason: "end_turn" as const,
			stop_sequence: null,
			usage: {
				input_tokens: 3,
				output_tokens: 7,
				cache_read_input_tokens: 4,
			},
		};

		expect(ANTHROPIC_MESSAGES_SPEC.response.firstChoice(stub)).toBeUndefined();
		expect(ANTHROPIC_MESSAGES_SPEC.response.finishReason(stub)).toBe(
			"end_turn",
		);
		expect(ANTHROPIC_MESSAGES_SPEC.response.outputText(stub)).toBe("");
		// usage() normalizes AnthropicUsage -> ResponseUsage with total_tokens
		// and surfaces cached_tokens under input_tokens_details.
		expect(ANTHROPIC_MESSAGES_SPEC.response.usage(stub)).toEqual({
			input_tokens: 3,
			output_tokens: 7,
			total_tokens: 10,
			input_tokens_details: { cached_tokens: 4 },
		});
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
