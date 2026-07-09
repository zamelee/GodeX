import {
	BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
	BRIDGE_REQUEST_UNSUPPORTED_TOOL,
	BridgeError,
} from "../../error";
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionContentPart,
	ChatCompletionCreateRequest,
	ChatCompletionMessageParam,
	ChatCompletionToolChoiceOption,
} from "../../protocol/openai/completions";
import type {
	ResponseCreateRequest,
	ResponseToolChoice,
} from "../../protocol/openai/responses";
import type { ReasoningEffort } from "../../protocol/openai/shared";
import type { ResponseSessionSnapshot } from "../../session";
import type { BridgeContentBlock, BridgeMessage } from "../bridge-types";
import {
	type ProviderCapabilities,
	planBridgeCompatibility,
} from "../compatibility";
import { type OutputContractPlan, planOutputContract } from "../output";
import {
	applyPluginChatMessagesHooks,
	type GodexPlugin,
	type GodexPluginContext,
} from "../plugins";
import {
	planTools,
	renderProviderToolDeclarations,
	type ToolPlan,
	type ToolPlanningProfile,
	type WebSearchPlanningOptions,
} from "../tools";
import {
	type InputNormalizerContext,
	normalizeCurrentInput,
	normalizeResponseItems,
} from "./input-normalizer";

export interface BuildChatCompletionRequestInput {
	readonly request: ResponseCreateRequest;
	readonly provider: string;
	readonly model: string;
	readonly capabilities: ProviderCapabilities;
	readonly profile: ToolPlanningProfile;
	readonly session?: ResponseSessionSnapshot | null;
	readonly plugins?: readonly GodexPlugin[];
	readonly webSearch?: WebSearchPlanningOptions;
}

export interface BuildChatCompletionRequestResult {
	readonly request: ChatCompletionCreateRequest;
	readonly compatibility: ReturnType<typeof planBridgeCompatibility>;
	readonly tools: ToolPlan;
	readonly output: OutputContractPlan;
}

export { type BridgeMessage, normalizeCurrentInput };

// ============================================================
// Message-merge layer
// ============================================================

export function buildChatCompletionsMessages(
	bridge: readonly BridgeMessage[],
): ChatCompletionMessageParam[] {
	// Phase 1: translate each BridgeMessage (block shape) to one or more
	// Chat messages (Chat-shape). A single user-role message with multiple
	// tool_result blocks becomes multiple Chat tool messages; a single
	// assistant-role message with tool_use blocks becomes one Chat
	// assistant message with a tool_calls field.
	const translated: ChatCompletionMessageParam[] = [];
	for (const message of bridge) {
		translated.push(...bridgeToChatMessages(message));
	}
	// Phase 2: apply the existing merge logic to the translated list.
	return mergeTranslatedChatMessages(translated);
}

function mergeTranslatedChatMessages(
	messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
	const merged: ChatCompletionMessageParam[] = [];
	for (const message of messages) {
		const next = cloneMessage(message);
		const previous = merged.at(-1);
		if (
			isAssistantToolCallMessage(previous) &&
			isAssistantToolCallMessage(next)
		) {
			previous.tool_calls = [...previous.tool_calls, ...next.tool_calls];
			const reasoningContent = mergeReasoningContent(
				previous.reasoning_content,
				next.reasoning_content,
			);
			if (reasoningContent) previous.reasoning_content = reasoningContent;
			continue;
		}
		if (
			isAssistantTurnPrefixMessage(previous) &&
			isAssistantTurnPrefixMessage(next)
		) {
			merged[merged.length - 1] = mergeAssistantTextMessages(previous, next);
			continue;
		}
		if (
			isAssistantTurnPrefixMessage(previous) &&
			isAssistantToolCallMessage(next)
		) {
			merged[merged.length - 1] = mergeAssistantTurnPrefix(previous, next);
			continue;
		}
		if (
			isAssistantToolCallMessage(previous) &&
			isAssistantTurnPrefixMessage(next)
		) {
			merged[merged.length - 1] = mergeAssistantToolCallSuffix(previous, next);
			continue;
		}
		merged.push(next);
	}
	return merged;
}

function bridgeToChatMessages(
	bridge: BridgeMessage,
): ChatCompletionMessageParam[] {
	const chat: ChatCompletionMessageParam[] = [];

	if (bridge.role === "system" || bridge.role === "developer") {
		const textBlocks = bridge.content.filter(isTextBlock);
		const nonTextBlocks = bridge.content.filter(
			(
				b,
			): b is Exclude<
				BridgeContentBlock,
				{ type: "text" } | { type: "reasoning" }
			> => b.type !== "text" && b.type !== "reasoning",
		);
		chat.push({
			role: "system",
			content: textBlocks.map((b) => b.text).join(""),
		});
		if (nonTextBlocks.length > 0) {
			chat.push({ role: "user", content: blocksToChatContent(nonTextBlocks) });
		}
		return chat;
	}

	if (bridge.role === "user") {
		const toolResultMessages: ChatCompletionMessageParam[] = [];
		const otherBlocks: BridgeContentBlock[] = [];
		for (const block of bridge.content) {
			if (block.type === "tool_result") {
				const contentText =
					typeof block.content === "string"
						? block.content
						: blocksToChatTextString(block.content);
				toolResultMessages.push({
					role: "tool",
					tool_call_id: block.tool_use_id,
					content: contentText,
				});
			} else {
				otherBlocks.push(block);
			}
		}
		chat.push(...toolResultMessages);
		if (otherBlocks.length > 0) {
			chat.push({ role: "user", content: blocksToChatContent(otherBlocks) });
		}
		return chat;
	}

	if (bridge.role === "assistant") {
		const toolUseBlocks = bridge.content.filter(isToolUseBlock);
		const reasoningText = bridge.content
			.filter(isReasoningBlock)
			.map((b) => b.text)
			.join("\n");
		const textBlocks = bridge.content.filter(isTextBlock);
		const mediaBlocks = bridge.content.filter(
			(
				b,
			): b is Extract<
				BridgeContentBlock,
				{ type: "image" } | { type: "video" }
			> => b.type === "image" || b.type === "video",
		);
		const chatMsg: ChatCompletionAssistantMessageParam = {
			role: "assistant",
			content:
				textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("") : "",
		};
		if (toolUseBlocks.length > 0) {
			chatMsg.tool_calls = toolUseBlocks.map((b) => ({
				id: b.id,
				type: "function",
				function: {
					name: b.name,
					arguments: JSON.stringify(b.input),
				},
			}));
		}
		if (reasoningText) {
			chatMsg.reasoning_content = reasoningText;
		}
		chat.push(chatMsg);
		if (mediaBlocks.length > 0) {
			chat.push({ role: "user", content: blocksToChatContent(mediaBlocks) });
		}
		return chat;
	}

	return chat;
}

function blocksToChatContent(
	blocks: readonly BridgeContentBlock[],
): string | ChatCompletionContentPart[] {
	if (blocks.length === 0) return "";

	const texts: string[] = [];
	const parts: ChatCompletionContentPart[] = [];
	let hasNonText = false;

	for (const block of blocks) {
		if (block.type === "text") {
			texts.push(block.text);
			parts.push({ type: "text", text: block.text });
			continue;
		}
		if (block.type === "image") {
			hasNonText = true;
			parts.push({
				type: "image_url",
				image_url: {
					url: block.url,
					...(block.detail ? { detail: block.detail } : {}),
				},
			});
			continue;
		}
		if (block.type === "video") {
			hasNonText = true;
			parts.push({
				type: "video_url",
				video_url: {
					url: block.url,
					...(block.detail ? { detail: block.detail } : {}),
				},
			});
		}
		// tool_use / tool_result / reasoning blocks are not expected here;
		// they are handled by bridgeToChatMessages before reaching this function.
	}

	if (!hasNonText) return texts.join("");
	return parts;
}

function blocksToChatTextString(blocks: readonly BridgeContentBlock[]): string {
	const texts: string[] = [];
	for (const block of blocks) {
		if (block.type === "text") texts.push(block.text);
		else texts.push(JSON.stringify(block));
	}
	return texts.join("\n");
}

function isTextBlock(
	block: BridgeContentBlock,
): block is { type: "text"; text: string } {
	return block.type === "text";
}

function isToolUseBlock(
	block: BridgeContentBlock,
): block is { type: "tool_use"; id: string; name: string; input: unknown } {
	return block.type === "tool_use";
}

function isReasoningBlock(
	block: BridgeContentBlock,
): block is { type: "reasoning"; text: string } {
	return block.type === "reasoning";
}

function cloneMessage(
	message: ChatCompletionMessageParam,
): ChatCompletionMessageParam {
	if (isAssistantToolCallMessage(message)) {
		return { ...message, tool_calls: [...message.tool_calls] };
	}
	return { ...message };
}

function mergeAssistantTextMessages(
	left: ChatCompletionAssistantMessageParam,
	right: ChatCompletionAssistantMessageParam,
): ChatCompletionAssistantMessageParam {
	const reasoningContent = mergeReasoningContent(
		left.reasoning_content,
		right.reasoning_content,
	);
	return {
		...left,
		content: mergeAssistantContent(left.content, right.content),
		...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
	};
}

function mergeAssistantTurnPrefix(
	prefix: ChatCompletionAssistantMessageParam,
	toolCallMessage: ChatCompletionAssistantMessageParam & {
		tool_calls: NonNullable<ChatCompletionAssistantMessageParam["tool_calls"]>;
	},
): ChatCompletionAssistantMessageParam {
	const reasoningContent = mergeReasoningContent(
		prefix.reasoning_content,
		toolCallMessage.reasoning_content,
	);
	return {
		...prefix,
		content: mergeAssistantContent(prefix.content, toolCallMessage.content),
		...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
		tool_calls: [...toolCallMessage.tool_calls],
	};
}

function mergeAssistantToolCallSuffix(
	toolCallMessage: ChatCompletionAssistantMessageParam & {
		tool_calls: NonNullable<ChatCompletionAssistantMessageParam["tool_calls"]>;
	},
	suffix: ChatCompletionAssistantMessageParam,
): ChatCompletionAssistantMessageParam {
	const reasoningContent = mergeReasoningContent(
		toolCallMessage.reasoning_content,
		suffix.reasoning_content,
	);
	return {
		...toolCallMessage,
		content: mergeAssistantContent(toolCallMessage.content, suffix.content),
		...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
		tool_calls: [...toolCallMessage.tool_calls],
	};
}

function isAssistantTurnPrefixMessage(
	message: ChatCompletionMessageParam | undefined,
): message is ChatCompletionAssistantMessageParam {
	return (
		message?.role === "assistant" &&
		!message.audio &&
		!message.function_call &&
		!message.refusal &&
		(!Array.isArray(message.tool_calls) || message.tool_calls.length === 0)
	);
}

function isAssistantToolCallMessage(
	message: ChatCompletionMessageParam | undefined,
): message is ChatCompletionAssistantMessageParam & {
	tool_calls: NonNullable<ChatCompletionAssistantMessageParam["tool_calls"]>;
} {
	return (
		message?.role === "assistant" &&
		Array.isArray(message.tool_calls) &&
		message.tool_calls.length > 0
	);
}

function mergeAssistantContent(
	left: ChatCompletionAssistantMessageParam["content"],
	right: ChatCompletionAssistantMessageParam["content"],
): ChatCompletionAssistantMessageParam["content"] {
	if (!left || (Array.isArray(left) && left.length === 0)) return right;
	if (!right || (Array.isArray(right) && right.length === 0)) return left;
	if (typeof left === "string" && typeof right === "string") {
		return `${left}
${right}`;
	}
	if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
	return left;
}

function mergeReasoningContent(
	left: string | null | undefined,
	right: string | null | undefined,
): string | null | undefined {
	if (!left) return right;
	if (!right) return left;
	return `${left}
${right}`;
}

// ============================================================
// Request-construction layer
// ============================================================

const REASONING_EFFORTS = new Set<ReasoningEffort>([
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return (
		typeof value === "string" && REASONING_EFFORTS.has(value as ReasoningEffort)
	);
}

function dropOrphanToolOutputs(
	messages: readonly BridgeMessage[],
): BridgeMessage[] {
	const knownCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type === "tool_use" && block.id) {
				knownCallIds.add(block.id);
			}
		}
	}
	return messages.flatMap((message) => {
		if (message.role !== "user") return [message];
		const filteredContent = message.content.filter((block) => {
			if (block.type !== "tool_result") return true;
			return knownCallIds.has(block.tool_use_id);
		});
		if (filteredContent.length === message.content.length) {
			return [message];
		}
		return [{ ...message, content: filteredContent }];
	});
}

function appendFinalInstruction(
	messages: BridgeMessage[],
	instruction: string,
): void {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message && isFinalInstructionTarget(message)) {
			messages[index] = {
				...message,
				content: [
					...message.content,
					{ type: "text", text: `\n\n${instruction}` },
				],
			};
			return;
		}
	}
	messages.push({
		role: "system",
		content: [{ type: "text", text: `\n\n${instruction}` }],
	});
}

function isFinalInstructionTarget(message: BridgeMessage): boolean {
	return (
		message.role === "developer" ||
		message.role === "system" ||
		message.role === "user"
	);
}

function systemPrefixLength(messages: readonly BridgeMessage[]): number {
	const firstNonSystem = messages.findIndex(
		(message) => message.role !== "system",
	);
	return firstNonSystem === -1 ? messages.length : firstNonSystem;
}

function assertNoRejectedCompatibility(
	input: BuildChatCompletionRequestInput,
	compatibility: ReturnType<typeof planBridgeCompatibility>,
): void {
	const responseFormat = compatibility.responseFormat;
	if (responseFormat?.action !== "rejected") return;
	throw new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
		responseFormat.reason ??
			`text.format is not supported by provider ${input.provider}.`,
		{
			provider: input.provider,
			model: input.model,
			parameter: "text.format",
		},
	);
}

function applyTools(
	request: ChatCompletionCreateRequest,
	input: BuildChatCompletionRequestInput,
	tools: ToolPlan,
): void {
	if (input.request.tool_choice === "none" || !tools.enabled) return;

	const declarations = renderProviderToolDeclarations(tools.declarations);
	if (declarations.length !== tools.declarations.length) {
		throw new BridgeError(
			BRIDGE_REQUEST_UNSUPPORTED_TOOL,
			`Provider-native tool rendering is not implemented for provider ${input.provider}: ${unrenderedProviderToolTypes(tools).join(", ")}.`,
			{
				provider: input.provider,
				model: input.model,
				parameter: "tools",
			},
		);
	}

	request.tools =
		declarations as unknown as ChatCompletionCreateRequest["tools"];
	const providerToolChoice = chatToolChoice(tools.providerToolChoice);
	if (providerToolChoice !== undefined) {
		request.tool_choice = providerToolChoice;
	}
}

function applyRequestOptions(
	request: ChatCompletionCreateRequest,
	source: ResponseCreateRequest,
	capabilities: ProviderCapabilities,
	provider: string,
	model: string,
): void {
	if (
		source.stream === true &&
		capabilities.parameters.supported.has("stream")
	) {
		request.stream = true;
		if (capabilities.streaming.usage) {
			request.stream_options = { include_usage: true };
		}
	}
	if (
		typeof source.temperature === "number" &&
		capabilities.parameters.supported.has("temperature")
	) {
		request.temperature = source.temperature;
	}
	if (
		typeof source.top_p === "number" &&
		capabilities.parameters.supported.has("top_p")
	) {
		request.top_p = source.top_p;
	}
	if (
		typeof source.max_output_tokens === "number" &&
		capabilities.parameters.supported.has("max_output_tokens")
	) {
		request.max_tokens = source.max_output_tokens;
	}
	if (
		source.reasoning?.effort &&
		capabilities.parameters.supported.has("reasoning")
	) {
		applyReasoningOption(request, source, capabilities, provider, model);
	}
	if (
		source.safety_identifier &&
		capabilities.parameters.supported.has("safety_identifier")
	) {
		request.user_id = source.safety_identifier;
		return;
	}
	if (source.user && capabilities.parameters.supported.has("user")) {
		request.user_id = source.user;
	}
}

function applyReasoningOption(
	request: ChatCompletionCreateRequest,
	source: ResponseCreateRequest,
	capabilities: ProviderCapabilities,
	provider: string,
	model: string,
): void {
	const effort = source.reasoning?.effort;
	if (!effort) return;
	if (!isReasoningEffort(effort)) {
		throw new BridgeError(
			BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
			`Unsupported reasoning.effort value for provider ${provider}: ${String(effort)}.`,
			{ provider, model, parameter: "reasoning.effort", value: effort },
		);
	}
	switch (capabilities.reasoning.effort) {
		case "native":
			request.reasoning_effort =
				effort as ChatCompletionCreateRequest["reasoning_effort"];
			return;
		case "boolean":
			request.thinking = {
				type: effort === "none" ? "disabled" : "enabled",
			};
			return;
		case "none":
			return;
		default:
			unsupportedReasoningCapabilityMode(
				capabilities.reasoning.effort,
				provider,
				model,
			);
	}
}

function unsupportedReasoningCapabilityMode(
	mode: never,
	provider: string,
	model: string,
): never {
	throw new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
		`Unsupported provider reasoning.effort mode for ${provider}: ${String(mode)}.`,
		{
			provider,
			model,
			parameter: "reasoning.effort.mode",
			value: mode,
		},
	);
}

function chatToolChoice(
	toolChoice: ResponseToolChoice | undefined,
): ChatCompletionToolChoiceOption | undefined {
	if (toolChoice === undefined || toolChoice === "none") return undefined;
	if (typeof toolChoice === "string") return toolChoice;
	if (toolChoice.type === "function") {
		return { type: "function", function: { name: toolChoice.name } };
	}
	if (toolChoice.type === "custom") {
		return { type: "custom", custom: { name: toolChoice.name } };
	}
	return undefined;
}

function unrenderedProviderToolTypes(tools: ToolPlan): string[] {
	return [
		...new Set(
			tools.declarations
				.filter((tool) => tool.providerType !== "function")
				.map((tool) => tool.providerType),
		),
	];
}

function normalizerContext(
	input: BuildChatCompletionRequestInput,
	tools?: ToolPlan,
): InputNormalizerContext {
	return {
		provider: input.provider,
		model: input.model,
		toolPlan: tools,
		supportsImageInput:
			input.capabilities.parameters.supported.has("input.image"),
		supportsVideoInput:
			input.capabilities.parameters.supported.has("input.video"),
	};
}

function chatMessages(
	input: BuildChatCompletionRequestInput,
	output: OutputContractPlan,
	tools: ToolPlan,
): ChatCompletionMessageParam[] {
	const context = normalizerContext(input, tools);
	const history = input.session?.input_items
		? normalizeResponseItems(input.session.input_items, input.request, context)
		: [];
	const current = normalizeCurrentInput(input.request, context);
	const currentPrefixLength = systemPrefixLength(current);
	const preamble = current.slice(0, currentPrefixLength);
	const messages = [
		...preamble,
		...history,
		...current.slice(currentPrefixLength),
	];
	if (output.jsonSchemaInstruction) {
		appendFinalInstruction(messages, output.jsonSchemaInstruction);
	}
	return buildChatCompletionsMessages(dropOrphanToolOutputs(messages));
}

export async function buildChatCompletionRequest(
	input: BuildChatCompletionRequestInput,
): Promise<BuildChatCompletionRequestResult> {
	const compatibility = planBridgeCompatibility({
		provider: input.provider,
		model: input.model,
		request: input.request,
		capabilities: input.capabilities,
	});
	const tools = planTools({
		tools: input.request.tools,
		toolChoice: input.request.tool_choice,
		profile: {
			...input.profile,
			webSearch: input.webSearch,
		},
	});
	assertNoRejectedCompatibility(input, compatibility);
	const output = planOutputContract({
		format: input.request.text?.format,
		responseFormatDecision: compatibility.responseFormat,
	});
	const request: ChatCompletionCreateRequest = {
		model: input.model,
		messages: chatMessages(input, output, tools),
	};
	applyTools(request, input, tools);
	if (output.providerResponseFormat !== undefined) {
		request.response_format =
			output.providerResponseFormat as ChatCompletionCreateRequest["response_format"];
	}
	const pluginCtx: GodexPluginContext = {
		model: input.model,
		provider: input.provider,
	};
	const plugins = input.plugins ?? [];
	request.messages = await applyPluginChatMessagesHooks(
		plugins,
		request.messages,
		pluginCtx,
	);
	applyRequestOptions(
		request,
		input.request,
		input.capabilities,
		input.provider,
		input.model,
	);
	return { request, compatibility, tools, output };
}
