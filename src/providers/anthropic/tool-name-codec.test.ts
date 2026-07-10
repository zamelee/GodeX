import { describe, expect, test } from "bun:test";
import {
	ANTHROPIC_TOOL_NAME_MAX_LENGTH,
	AnthropicToolNameCodec,
} from "./tool-name-codec";

describe("AnthropicToolNameCodec", () => {
	test("passes through already-valid names without modification", () => {
		const codec = new AnthropicToolNameCodec();
		expect(codec.toProviderName("get_weather")).toBe("get_weather");
		expect(codec.toProviderName("apply_patch")).toBe("apply_patch");
		expect(codec.toProviderName("web_search")).toBe("web_search");
		expect(codec.toProviderName("godex_chrome_list_pages")).toBe(
			"godex_chrome_list_pages",
		);
	});

	test("sanitizes Codex-style namespace and dotted names", () => {
		const codec = new AnthropicToolNameCodec();
		// Anthropic rejects '.' and '/' and '@'. The codec should rewrite them.
		expect(codec.toProviderName("some.namespace/tool@v2")).toBe(
			"some_namespace_tool_v2",
		);
		// Codex MCP-style: double underscore is legal for Anthropic; pass through.
		expect(codec.toProviderName("mcp__chrome_devtools__navigate_page")).toBe(
			"mcp__chrome_devtools__navigate_page",
		);
	});

	test("falls back to 'tool' only when the name is empty after sanitize", () => {
		const codec = new AnthropicToolNameCodec();
		// Empty input -> fallback to default placeholder.
		expect(codec.toProviderName("")).toBe("tool");
		// Pure punctuation sanitizes to underscores, which IS a valid Anthropic name.
		expect(codec.toProviderName("///")).toBe("___");
	});

	test("truncates names longer than 64 chars and preserves round-trip", () => {
		const codec = new AnthropicToolNameCodec();
		const longName = "x".repeat(100);
		const encoded = codec.toProviderName(longName);
		expect(encoded.length).toBeLessThanOrEqual(ANTHROPIC_TOOL_NAME_MAX_LENGTH);
		expect(codec.fromProviderName(encoded)).toBe(longName);
	});

	test("resolves collisions with suffix and preserves round-trip for both", () => {
		const codec = new AnthropicToolNameCodec();
		const a = "foo.bar";
		const b = "foo/bar";
		// Both sanitize to foo_bar.
		const encA = codec.toProviderName(a);
		const encB = codec.toProviderName(b);
		expect(encA).toBe("foo_bar");
		expect(encB).toBe("foo_bar_2");
		expect(codec.fromProviderName(encA)).toBe(a);
		expect(codec.fromProviderName(encB)).toBe(b);
	});

	test("resolves many collisions deterministically", () => {
		const codec = new AnthropicToolNameCodec();
		const names = ["a.b", "a/b", "a-b", "a_b", "a:b"];
		const encoded = names.map((n) => codec.toProviderName(n));
		// All distinct.
		expect(new Set(encoded).size).toBe(names.length);
		// All round-trip cleanly.
		for (let i = 0; i < names.length; i++) {
			expect(codec.fromProviderName(encoded[i] as string)).toBe(names[i]);
		}
	});

	test("fromProviderName returns undefined for unknown names", () => {
		const codec = new AnthropicToolNameCodec();
		expect(codec.fromProviderName("never_encoded")).toBeUndefined();
	});

	test("caches toProviderName results so repeated calls return identical names", () => {
		const codec = new AnthropicToolNameCodec();
		const first = codec.toProviderName("ns/tool");
		const second = codec.toProviderName("ns/tool");
		expect(first).toBe(second);
	});

	test("size helper reports current mapping cardinality", () => {
		const codec = new AnthropicToolNameCodec();
		expect(codec.size()).toEqual({ providers: 0, codex: 0 });
		codec.toProviderName("foo");
		codec.toProviderName("bar.baz");
		expect(codec.size().providers).toBe(2);
		expect(codec.size().codex).toBe(2);
	});

	test("encoded names always satisfy the Anthropic regex", () => {
		const codec = new AnthropicToolNameCodec();
		const weirdNames = [
			"",
			"///",
			"some.namespace/tool@v2",
			"x".repeat(200),
			"中文tool",
			"!!!@@@###",
			"-leading-dash",
			"_leading_underscore",
		];
		for (const name of weirdNames) {
			const encoded = codec.toProviderName(name);
			expect(encoded).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
			expect(codec.fromProviderName(encoded)).toBe(
				name === "" ? "" : name === "///" ? "///" : name,
			);
		}
	});
});
