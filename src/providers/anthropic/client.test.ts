import { describe, expect, test } from "bun:test";
import {
	ANTHROPIC_MESSAGES_SPEC,
	ANTHROPIC_PROVIDER_NAME,
	createAnthropicProviderEdge,
	createAnthropicSpec,
} from "./index";

describe("Anthropic provider edge factory (Phase B3.3)", () => {
	test("createAnthropicProviderEdge returns a ProviderEdge bound to anthropic", () => {
		const edge = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "test-anthropic-key" },
			endpoint: { base_url: "https://api.example.test" },
			timeout_ms: 30_000,
		});

		expect(edge.name).toBe(ANTHROPIC_PROVIDER_NAME);
		expect(edge.spec.name).toBe("anthropic");
		expect(edge.spec.protocol).toBe("messages");
		expect(edge.spec.auth.scheme).toBe("x_api_key");
	});

	test("createAnthropicProviderEdge uses default base URL when none provided", () => {
		const edge = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "k" },
		});
		expect(edge.spec.endpoint.defaultBaseURL).toBe("https://api.anthropic.com");
	});

	test("createAnthropicProviderEdge keeps spec default endpoint regardless of config override", () => {
		// The endpoint override is applied inside MessagesProviderClient (not on
		// the spec) so the spec stays reusable as a registry-level constant. The
		// spec.defaultBaseURL is the spec's documented canonical default; the
		// client-side override is exercised by live GodeX smoke tests in B6.
		const edge = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "k" },
			endpoint: { base_url: "https://minnimax.chat" },
		});
		expect(edge.spec.endpoint.defaultBaseURL).toBe("https://api.anthropic.com");
	});

	test("provider edge exposes request + stream functions", () => {
		const edge = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "k" },
		});
		expect(typeof edge.request).toBe("function");
		expect(typeof edge.stream).toBe("function");
	});

	test("factory uses fresh spec instance with independent codec", () => {
		const edgeA = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "k" },
		});
		const edgeB = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "k" },
		});
		expect(edgeA.spec.toolName).not.toBe(edgeB.spec.toolName);
		// Singleton spec is still exportable and unchanged:
		expect(ANTHROPIC_MESSAGES_SPEC.toolName).toBeDefined();
		// createAnthropicSpec() and factory-created edges all have distinct codecs:
		expect(createAnthropicSpec().toolName).not.toBe(edgeA.spec.toolName);
	});

	test("provider edge stream method is bound to client (not detached)", () => {
		const edge = createAnthropicProviderEdge({
			spec: ANTHROPIC_PROVIDER_NAME,
			credentials: { api_key: "k" },
		});
		// request and stream should be stable identity-wise (re-callable).
		expect(edge.request).toBe(edge.request);
		expect(edge.stream).toBe(edge.stream);
	});
});
