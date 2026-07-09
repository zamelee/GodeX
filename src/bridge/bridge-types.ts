// src/bridge/bridge-types.ts
//
// Neutral bridge types shared by request normalization, message building,
// and provider-specific request construction. These types intentionally
// carry no OpenAI Chat Completions, Anthropic Messages, or Responses API
// vocabulary in their names so that downstream consumers (request
// dispatcher, response reconstructor, future Anthropic adapter) can
// operate against a protocol-agnostic shape.
//
// Phase A step 2 (2026-07-09): minimal rename. BridgeMessage,
// BridgeContentBlock, and BridgeRole are aliases for the OpenAI Chat
// Completions types they currently correspond to. The internal
// implementation continues to use Chat types inside provider-specific
// adapters (the "折中1" pattern from F class step 1). A truly neutral
// representation is deferred to Phase B once Open Questions 1-3 from
// handoffs/2026-07-09-fclass-step1-bridge-accessor-rename.md are
// resolved (BridgeMessage.role shape, BridgeContentBlock.type enum,
// Anthropic thinking default policy).

import type {
	ChatCompletionContentPart,
	ChatCompletionMessageParam,
} from "../protocol/openai/completions";

/**
 * A single message in the normalized input/output history. Currently an
 * alias for the OpenAI Chat Completions ChatCompletionMessageParam;
 * downstream providers (chat-completions today, anthropic-messages in
 * Phase B) consume this through their own adapters.
 */
export type BridgeMessage = ChatCompletionMessageParam;

/**
 * A single content part within a BridgeMessage. Today an alias for the
 * OpenAI Chat Completions ChatCompletionContentPart; the Anthropic
 * adapter will convert tool_use / tool_result blocks to this shape at
 * the bridge boundary.
 */
export type BridgeContentBlock = ChatCompletionContentPart;

/**
 * Role discriminator on BridgeMessage. Matches the OpenAI Chat
 * Completions role union ("system" | "user" | "assistant" | "tool" |
 * "developer" | "function"); Anthropic has no equivalent role union and
 * expresses tool results as content blocks, so the adapter layer will
 * normalize.
 */
export type BridgeRole = BridgeMessage["role"];
