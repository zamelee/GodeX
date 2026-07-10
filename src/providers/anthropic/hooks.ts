// src/providers/anthropic/hooks.ts
//
// Anthropic provider capabilities and request hooks (Phase B3.2).
//
// Capabilities reflect what Anthropic's /v1/messages API natively supports.
// Tools that Codex declares but Anthropic cannot express natively (apply_patch,
// local_shell, file_search, namespace, custom) are degraded to plain function
// tools — the AnthropicToolNameCodec handles any sanitization the names need.
//
// The patchRequest hook is a stub for now (identity transform). B3.4 fills it
// in to inject metadata.user_id from Codex request headers and to strip
// cache_control when the upstream does not support prompt caching.

import type { ProviderCapabilities } from "../../bridge/compatibility";
import type { AnthropicMessagesRequest } from "./protocol";

export const ANTHROPIC_MAX_TOOLS = 32;

export const ANTHROPIC_SUPPORTED_TOOL_TYPES: ReadonlySet<string> = new Set([
	"function",
	"web_search",
]);

// Tools that Codex declares in Responses API but Anthropic cannot represent
// natively — degrade to a generic function tool so the request still goes
// through. The caller (model) sees a function call and the bridge routes it
// back through Codex's standard function-call mechanism.
export const ANTHROPIC_DEGRADED_TOOL_TYPES: ReadonlyMap<string, string> =
	new Map([
		["file_search", "function"],
		["local_shell", "function"],
		["shell", "function"],
		["apply_patch", "function"],
		["custom", "function"],
		["namespace", "function"],
	]);

export const ANTHROPIC_SPEC_CAPABILITIES: ProviderCapabilities = {
	parameters: {
		supported: new Set([
			"stream",
			"temperature",
			"top_p",
			"max_output_tokens",
			"metadata",
			"thinking",
		]),
	},
	tools: {
		supported: ANTHROPIC_SUPPORTED_TOOL_TYPES,
		degraded: ANTHROPIC_DEGRADED_TOOL_TYPES,
		maxTools: ANTHROPIC_MAX_TOOLS,
	},
	toolChoice: {
		supported: new Set(["auto", "any", "none", "tool"]),
	},
	responseFormats: {
		// Anthropic has no native json_object response_format — structured output
		// must go through a tool with input_schema. The bridge degrades json_*
		// to text and surfaces a diagnostic.
		supported: new Set(["text"]),
	},
	reasoning: { effort: "native" },
	streaming: { usage: true },
};

/**
 * Identity patch hook for now. B3.4 extends this to:
 *   - inject metadata.user_id from Codex request headers
 *   - strip cache_control when the resolved provider is not canonical Anthropic
 *   - enforce max_tokens minimum (Anthropic rejects < 1)
 */
export function anthropicPatchRequest(
	request: AnthropicMessagesRequest,
): AnthropicMessagesRequest {
	return request;
}
