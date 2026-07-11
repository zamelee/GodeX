// src/bridge/request/anthropic-messages-builder.ts
//
// Translate a Codex Responses API request into an Anthropic Messages API
// request body. Companion to chat-completions-builder.ts (which targets
// /v1/chat/completions); both consume BridgeMessage[] from the
// input-normalizer (Phase B1) and differ only in how they shape the
// provider wire body.
//
// Phase B3.4 fills in the implementation that was stubbed in
// Phase A step 4 (Round 4 commit 457e3f0).
//
// Translation map (Codex Responses -> Anthropic Messages):
//
//   Codex                              Anthropic
//   ---------------------------------  ----------------------------------
//   request.instructions               request.system (top-level)
//   BridgeMessage { role:system }      -> concatenated into system
//   BridgeMessage { role:developer }   -> concatenated into system
//   BridgeMessage { role:user }        -> { role:"user", content:[...] }
//   BridgeMessage { role:assistant }   -> { role:"assistant", content:[...] }
//   BridgeContentBlock { type:text }   -> { type:"text", text }
//   BridgeContentBlock { type:image }  -> { type:"image", source:{...} }
//   BridgeContentBlock { type:video }  -> BRIDGE_REQUEST_UNSUPPORTED (no video)
//   BridgeContentBlock { type:tool_use }  -> { type:"tool_use", id, name, input }
//   BridgeContentBlock { type:tool_result } -> { type:"tool_result", tool_use_id, content }
//   BridgeContentBlock { type:reasoning }   -> dropped (already summarized)
//   tools[i] (function)                -> tools[i] (function, sanitized name)
//   tool_choice = "auto"|"none"|"required"  -> { type:"auto"|"none"|"any" }
//   tool_choice = { type:function }   -> { type:"tool", name:<sanitized> }
//   reasoning.effort                  -> thinking.{type, budget_tokens} (OQ3)
//   max_output_tokens                 -> max_tokens (default 1024, min 1)
//   metadata.user_id                   -> metadata.user_id
//   stream                             -> stream
//   temperature / top_p                -> temperature / top_p

import { BRIDGE_REQUEST_UNSUPPORTED_PARAMETER, BridgeError } from "../../error";
import type {
	ResponseCreateRequest,
	ResponseTool,
} from "../../protocol/openai/responses";
import type { ReasoningEffort } from "../../protocol/openai/shared";
import type {
	AnthropicContentBlock,
	AnthropicImageBlock,
	AnthropicMessage,
	AnthropicMessagesRequest,
	AnthropicMetadata,
	AnthropicThinkingConfig,
	AnthropicTool,
	AnthropicToolChoice,
} from "../../providers/anthropic/protocol";
import { AnthropicToolNameCodec } from "../../providers/anthropic/tool-name-codec";
import type { ResponseSessionSnapshot } from "../../session";
import type { BridgeContentBlock, BridgeMessage } from "../bridge-types";
import {
	type ProviderCapabilities,
	planBridgeCompatibility,
} from "../compatibility";
import { type OutputContractPlan, planOutputContract } from "../output";
import {
	planTools,
	type ToolPlan,
	type ToolPlanningProfile,
	type WebSearchPlanningOptions,
} from "../tools";
import {
	type InputNormalizerContext,
	normalizeCurrentInput,
	normalizeResponseItems,
} from "./input-normalizer";

export interface BuildAnthropicMessagesRequestInput {
	readonly request: ResponseCreateRequest;
	readonly provider: string;
	readonly model: string;
	readonly capabilities: ProviderCapabilities;
	readonly profile: ToolPlanningProfile;
	readonly session?: ResponseSessionSnapshot | null;
	readonly plugins?: readonly unknown[];
	readonly webSearch?: WebSearchPlanningOptions;
}

export interface BuildAnthropicMessagesRequestResult {
	readonly request: AnthropicMessagesRequest;
	readonly compatibility: ReturnType<typeof planBridgeCompatibility>;
	readonly tools: ToolPlan;
	readonly output: OutputContractPlan;
}

// --- Defaults ---

const ANTHROPIC_MAX_TOKENS_DEFAULT = 1024;
const ANTHROPIC_MAX_TOKENS_MIN = 1;

// --- OQ3: thinking budget per Codex reasoning.effort ---
// Source: handoffs/2026-07-10-phase-b-anthropic-design.md section 7 OQ3.

function thinkingBudgetTokensForEffort(effort: ReasoningEffort): number {
	switch (effort) {
		case "high":
			return 4096;
		case "xhigh":
			return 16384;
		case "minimal":
		case "low":
		case "medium":
			return 1024;
		default:
			return 0; // unused when type=disabled
	}
}

function buildThinking(
	reasoning: { effort?: ReasoningEffort } | undefined,
): AnthropicThinkingConfig | undefined {
	if (!reasoning?.effort) return undefined;
	if (reasoning.effort === "none") return { type: "disabled" };
	return {
		type: "enabled",
		budget_tokens: thinkingBudgetTokensForEffort(reasoning.effort),
	};
}

// --- System field extraction ---

function extractSystemText(messages: readonly BridgeMessage[]): string {
	const parts: string[] = [];
	for (const m of messages) {
		if (m.role !== "system" && m.role !== "developer") continue;
		for (const block of m.content) {
			if (block.type === "text") parts.push(block.text);
		}
	}
	return parts.join("\n\n");
}

function buildSystemField(
	instructions: string | undefined,
	normalizedMessages: readonly BridgeMessage[],
): string | undefined {
	const fromInstructions = instructions ?? "";
	const fromMessages = extractSystemText(normalizedMessages);
	if (fromInstructions && fromMessages) {
		return `${fromInstructions}\n\n${fromMessages}`;
	}
	return fromInstructions || fromMessages || undefined;
}

// --- Content-block translation ---

function imageBlockToAnthropic(block: {
	readonly type: "image";
	readonly url: string;
}): AnthropicImageBlock {
	// Codex sends image url as either a data: URI (already base64) or an
	// HTTP(S) URL. Anthropic accepts both natively. We do NOT fetch+base64
	// by default (Anthropic fetches URL images server-side, which is faster
	// than a client-side round-trip). The B3.4 builder relies on Anthropic
	// doing the fetch; if a future minimax.chat proxy probe shows URL
	// sources are rejected, add a fetch-and-encode fallback here.
	const dataMatch = /^data:([^;]+);base64,(.*)$/u.exec(block.url);
	if (dataMatch) {
		return {
			type: "image",
			source: {
				type: "base64",
				media_type: dataMatch[1] ?? "image/png",
				data: dataMatch[2] ?? "",
			},
		};
	}
	return {
		type: "image",
		source: { type: "url", url: block.url },
	};
}

function bridgeContentToAnthropic(
	block: BridgeContentBlock,
	codec: AnthropicToolNameCodec,
): AnthropicContentBlock | AnthropicContentBlock[] | null {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text };
		case "image":
			return imageBlockToAnthropic(block);
		case "video":
			// Anthropic has no native video input. Surface a clear error so
			// the caller knows to drop or replace the video block rather than
			// silently truncating the request.
			throw new BridgeError(
				BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
				"Anthropic does not support video input; remove or replace the video content block.",
				{
					provider: "anthropic",
					model: "anthropic",
					parameter: "messages[].content[].video",
				},
			);
		case "tool_use": {
			const sanitizedName = codec.toProviderName(block.name);
			return {
				type: "tool_use",
				id: block.id,
				name: sanitizedName,
				input: block.input,
			};
		}
		case "tool_result": {
			if (typeof block.content === "string") {
				return {
					type: "tool_result",
					tool_use_id: block.tool_use_id,
					content: block.content,
					is_error: block.is_error,
				};
			}
			// Nested blocks: flatten into a single tool_result with content array.
			const inner: AnthropicContentBlock[] = [];
			for (const nested of block.content) {
				const translated = bridgeContentToAnthropic(nested, codec);
				if (translated === null) continue;
				if (Array.isArray(translated)) inner.push(...translated);
				else inner.push(translated);
			}
			return {
				type: "tool_result",
				tool_use_id: block.tool_use_id,
				content: inner,
				is_error: block.is_error,
			};
		}
		case "reasoning":
			// Reasoning is surfaced in output via Anthropic thinking blocks; in
			// input we drop the reasoning text (Codex session management
			// already folded the summary into the conversation context).
			return null;
	}
}

function bridgeToAnthropicMessages(
	bridgeMessages: readonly BridgeMessage[],
	codec: AnthropicToolNameCodec,
): AnthropicMessage[] {
	const out: AnthropicMessage[] = [];
	for (const m of bridgeMessages) {
		if (m.role === "system" || m.role === "developer") {
			// System/developer text is concatenated into the top-level system
			// field; do NOT emit role:"system" inside the messages array
			// because Anthropic rejects it.
			continue;
		}
		const blocks: AnthropicContentBlock[] = [];
		for (const block of m.content) {
			const translated = bridgeContentToAnthropic(block, codec);
			if (translated === null) continue;
			if (Array.isArray(translated)) blocks.push(...translated);
			else blocks.push(translated);
		}
		if (m.role === "user") {
			out.push({ role: "user", content: blocks });
		} else {
			out.push({ role: "assistant", content: blocks });
		}
	}
	return out;
}

// --- Tools ---

function buildTools(
	coxTools: readonly ResponseTool[] | undefined,
	codec: AnthropicToolNameCodec,
): AnthropicTool[] {
	if (!coxTools) return [];
	const out: AnthropicTool[] = [];
	for (const tool of coxTools) {
		if (tool.type === "function") {
			// Some Codex clients send Chat Completions nested tool shape
			// ({type:"function", function:{name, description, parameters}}) even when
			// targeting /v1/responses. Resolve that to the Responses flat shape
			// ({type:"function", name, description, parameters}) before sanitizing
			// the name through the codec. Without this, tool.name is undefined
			// and AnthropicToolNameCodec.sanitizeBase trips on name.replace.
			const nested = (tool as unknown as { function?: Record<string, unknown> })
				.function;
			const flat = nested && typeof nested === "object" ? nested : null;
			const rawName =
				(typeof tool.name === "string" && tool.name) ||
				(flat && typeof flat.name === "string" ? flat.name : "");
			if (!rawName) continue;
			const sanitizedName = codec.toProviderName(rawName);
			const params =
				(tool.parameters && typeof tool.parameters === "object"
					? (tool.parameters as Record<string, unknown>)
					: null) ??
				(flat && flat.parameters && typeof flat.parameters === "object"
					? (flat.parameters as Record<string, unknown>)
					: {});
			const description =
				(typeof tool.description === "string" && tool.description) ||
				(typeof flat?.description === "string" ? flat.description : undefined);
			const inputSchema: AnthropicTool["input_schema"] = {
				type: "object",
				properties:
					typeof params.properties === "object" && params.properties !== null
						? (params.properties as Record<string, unknown>)
						: undefined,
				required: Array.isArray(params.required)
					? (params.required as string[])
					: undefined,
			};
			// Carry through any additional JSON-Schema keys (additionalProperties,
			// $schema, etc.) the caller declared.
			for (const [key, value] of Object.entries(params)) {
				if (key === "properties" || key === "required" || key === "type") {
					continue;
				}
				(inputSchema as Record<string, unknown>)[key] = value;
			}
			out.push({
				name: sanitizedName,
				description,
				input_schema: inputSchema,
			});
		}
		// web_search tool: Anthropic does not have a web_search tool that
		// matches Codex's hosted-web-search shape; per the Phase B design
		// these would be degraded by planTools into a function-shaped
		// declaration. We accept nothing here; if the tool plan surfaced a
		// web_search declaration, the B4 stream transformer is responsible
		// for executing the search and feeding results back.
	}
	return out;
}

// --- Tool choice ---

function buildToolChoice(
	coxToolChoice: ResponseCreateRequest["tool_choice"],
	codec: AnthropicToolNameCodec,
): AnthropicToolChoice | undefined {
	if (coxToolChoice === undefined) return undefined;
	if (typeof coxToolChoice === "string") {
		switch (coxToolChoice) {
			case "auto":
				return { type: "auto" };
			case "none":
				return { type: "none" };
			case "required":
				return { type: "any" };
		}
	}
	if (coxToolChoice.type === "function") {
		return {
			type: "tool",
			name: codec.toProviderName(coxToolChoice.name),
		};
	}
	// tool_choice types Anthropic cannot represent natively
	// (allowed_tools, file_search, web_search_*, computer_*, code_interpreter,
	// image_generation, mcp, custom, apply_patch, shell) - degrade to auto.
	return { type: "auto" };
}

// --- Metadata ---

function buildMetadata(
	coxMetadata: { user_id?: string } | undefined,
): AnthropicMetadata | undefined {
	if (!coxMetadata?.user_id) return undefined;
	return { user_id: coxMetadata.user_id };
}

// --- Normalizer context ---

function normalizerContext(
	input: BuildAnthropicMessagesRequestInput,
	tools: ToolPlan,
): InputNormalizerContext {
	return {
		provider: input.provider,
		model: input.model,
		toolPlan: tools,
		supportsImageInput: true, // Anthropic supports image input natively
		supportsVideoInput: false, // Anthropic has no video input
	};
}

// --- Main entry ---

/**
 * Build an Anthropic Messages API request body from a Codex Responses
 * request, session history, and capability/tool plans.
 *
 * Replaces the Phase A step 4 stub. The dispatcher in
 * `request-dispatcher.ts` calls this when the resolved spec's protocol
 * is `MESSAGES_PROTOCOL`.
 */
export async function buildAnthropicMessagesRequest(
	input: BuildAnthropicMessagesRequestInput,
): Promise<BuildAnthropicMessagesRequestResult> {
	// 1) Plan compatibility (rejects unsupported features early).
	const compatibility = planBridgeCompatibility({
		provider: input.provider,
		model: input.model,
		request: input.request,
		capabilities: input.capabilities,
	});

	// 2) Plan tools (degrades Codex-specific tool types).
	const tools = planTools({
		tools: input.request.tools,
		toolChoice: input.request.tool_choice,
		profile: { ...input.profile, webSearch: input.webSearch },
	});

	// 3) Plan output contract (json_schema -> instruction suffix, etc.).
	const output = planOutputContract({
		format: input.request.text?.format,
		responseFormatDecision: compatibility.responseFormat,
	});

	// 4) Normalize session + current input into BridgeMessage[].
	const context = normalizerContext(input, tools);
	const history = input.session?.input_items
		? normalizeResponseItems(input.session.input_items, input.request, context)
		: [];
	const current = normalizeCurrentInput(input.request, context);

	// 5) Extract system prompt and produce messages array.
	// Pass ONLY history to buildSystemField. The auto-injected system
	// message that normalizeCurrentInput prepends when request.instructions
	// is set is a duplicate of input.request.instructions; it will be
	// filtered out by bridgeToAnthropicMessages (which drops role:system
	// and role:developer) so we do not want it counted twice in system.
	const system = buildSystemField(input.request.instructions, history);
	const codec = new AnthropicToolNameCodec();
	const messages = bridgeToAnthropicMessages([...history, ...current], codec);

	// 6) Compose the wire body. Required fields first; optional fields are
	//    added only when present so the request stays minimal.
	const anthropicRequest: AnthropicMessagesRequest = {
		model: input.model,
		messages,
		max_tokens: Math.max(
			ANTHROPIC_MAX_TOKENS_MIN,
			input.request.max_output_tokens ?? ANTHROPIC_MAX_TOKENS_DEFAULT,
		),
	};
	if (system) anthropicRequest.system = system;
	const anthropicTools = buildTools(input.request.tools, codec);
	if (anthropicTools.length > 0) anthropicRequest.tools = anthropicTools;
	const anthropicToolChoice = buildToolChoice(input.request.tool_choice, codec);
	if (anthropicToolChoice) anthropicRequest.tool_choice = anthropicToolChoice;
	const thinking = buildThinking(input.request.reasoning);
	if (thinking) anthropicRequest.thinking = thinking;
	const metadata = buildMetadata(input.request.metadata);
	if (metadata) anthropicRequest.metadata = metadata;
	if (input.request.temperature !== undefined) {
		anthropicRequest.temperature = input.request.temperature;
	}
	if (input.request.top_p !== undefined) {
		anthropicRequest.top_p = input.request.top_p;
	}
	if (input.request.stream !== undefined) {
		anthropicRequest.stream = input.request.stream;
	}

	return {
		request: anthropicRequest,
		compatibility,
		tools,
		output,
	};
}
