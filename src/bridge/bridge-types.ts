// src/bridge/bridge-types.ts
//
// Neutral bridge types shared by request normalization, message building,
// and provider-specific request construction. These types are intentionally
// protocol-agnostic: they carry neither OpenAI Chat Completions, Anthropic
// Messages, nor Responses API vocabulary in their shape. Each downstream
// builder (chat-completions-builder today, anthropic-messages-builder in
// Phase B3+) translates BridgeMessage[] into its provider-specific shape.
//
// Phase B1 (2026-07-10): canonical neutral type introduced.
//
// History:
//   - Phase A step 2 (2026-07-09): BridgeMessage / BridgeContentBlock / BridgeRole
//     were aliases for OpenAI Chat Completions types (the 折中1 pattern).
//   - Phase B1: alias dropped. BridgeMessage is now a real neutral shape
//     (role + content: BridgeContentBlock[]). The previous Chat shape is
//     re-derived inside chat-completions-builder via translation.

/**
 * A single content part within a BridgeMessage. Discriminated union by `type`.
 *
 * - text: plain string content
 * - image: URL or data: URI; detail optional for downstream fidelity hints
 * - video: URL or data: URI; detail optional
 * - tool_use: assistant-side tool call (id, name, parsed input)
 * - tool_result: tool output for a prior tool_use (tool_use_id + content)
 * - reasoning: model reasoning surfaced as text (Anthropic's thinking, OpenAI's reasoning summaries)
 */
export type BridgeContentBlock =
	| { readonly type: "text"; readonly text: string }
	| {
			readonly type: "image";
			readonly url: string;
			readonly detail?: "low" | "high";
	  }
	| {
			readonly type: "video";
			readonly url: string;
			readonly detail?: "low" | "high";
	  }
	| {
			readonly type: "tool_use";
			readonly id: string;
			readonly name: string;
			readonly input: unknown;
	  }
	| {
			readonly type: "tool_result";
			readonly tool_use_id: string;
			readonly content: string | readonly BridgeContentBlock[];
			readonly is_error?: boolean;
	  }
	| { readonly type: "reasoning"; readonly text: string };

/**
 * Role discriminator on BridgeMessage. Note: NO `tool` role. Tool outputs are
 * carried as `tool_result` blocks inside user-role messages; this keeps the
 * shape uniform across Chat (which uses `role: "tool"` natively) and Anthropic
 * (which uses `tool_result` blocks inside user messages). chat-completions-builder
 * splits tool_result blocks out into Chat `role: "tool"` messages during
 * translation; anthropic-messages-builder keeps them as-is.
 */
export type BridgeRole = "system" | "developer" | "user" | "assistant";

/**
 * A single message in the normalized input/output history. Content is always
 * an array of BridgeContentBlock; consumers (chat or anthropic builders)
 * translate into their provider-specific shape.
 */
export interface BridgeMessage {
	readonly role: BridgeRole;
	readonly content: readonly BridgeContentBlock[];
}
