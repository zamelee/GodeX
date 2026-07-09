import {
	BRIDGE_REQUEST_UNSUPPORTED_INPUT_CONTENT,
	BRIDGE_REQUEST_UNSUPPORTED_INPUT_ITEM,
	BridgeError,
} from "../../error";
import type {
	ResponseCreateRequest,
	ResponseItem,
} from "../../protocol/openai/responses";
import {
	canonicalizeFunctionArguments,
	isValidFunctionArguments,
} from "../../providers/shared/tool-arguments";
import type { BridgeContentBlock, BridgeMessage } from "../bridge-types";
import type { ToolPlan } from "../tools";

interface NormalizedToolOutput {
	readonly text: string;
	readonly extras: readonly BridgeContentBlock[];
}

export interface InputNormalizerContext {
	readonly provider?: string;
	readonly model?: string;
	readonly toolPlan?: ToolPlan;
	readonly supportsImageInput?: boolean;
	readonly supportsVideoInput?: boolean;
}

type TextOnlyInputNormalizerContext = InputNormalizerContext & {
	readonly supportsImageInput?: false;
	readonly supportsVideoInput?: false;
};

export function normalizeCurrentInput(
	request: ResponseCreateRequest,
	context: InputNormalizerContext = {},
): BridgeMessage[] {
	const messages: BridgeMessage[] = [];
	if (request.instructions) {
		messages.push({
			role: "system",
			content: [{ type: "text", text: request.instructions }],
		});
	}

	if (request.input === undefined) return messages;
	if (typeof request.input === "string") {
		messages.push({
			role: "user",
			content: [{ type: "text", text: request.input }],
		});
		return messages;
	}

	messages.push(...normalizeInputItems(request.input, request, context));
	return messages;
}

export function normalizeResponseItems(
	items: readonly ResponseItem[],
	request: ResponseCreateRequest,
	context: InputNormalizerContext = {},
): BridgeMessage[] {
	return normalizeInputItems(dropUnpairedToolCalls(items), request, context);
}

function dropUnpairedToolCalls(
	items: readonly ResponseItem[],
): readonly ResponseItem[] {
	return items.filter((item) => !isOrphanToolOutput(item, items));
}

function isOrphanToolOutput(
	item: ResponseItem,
	items: readonly ResponseItem[],
): boolean {
	if (!isToolOutput(item)) return false;
	const outputId = item.call_id;
	for (const candidate of items) {
		if (isToolCall(candidate) && candidate.call_id === outputId) {
			return false;
		}
	}
	return true;
}

type ToolCallItem = Extract<
	ResponseItem,
	{
		type:
			| "function_call"
			| "shell_call"
			| "local_shell_call"
			| "apply_patch_call"
			| "custom_tool_call";
	}
>;
type ToolOutputItem = Extract<
	ResponseItem,
	{
		type:
			| "function_call_output"
			| "shell_call_output"
			| "local_shell_call_output"
			| "apply_patch_call_output"
			| "custom_tool_call_output";
	}
>;

function isToolCall(item: ResponseItem): item is ToolCallItem {
	return (
		item.type === "function_call" ||
		item.type === "shell_call" ||
		item.type === "local_shell_call" ||
		item.type === "apply_patch_call" ||
		item.type === "custom_tool_call"
	);
}

function isToolOutput(item: ResponseItem): item is ToolOutputItem {
	return (
		item.type === "function_call_output" ||
		item.type === "shell_call_output" ||
		item.type === "local_shell_call_output" ||
		item.type === "apply_patch_call_output" ||
		item.type === "custom_tool_call_output"
	);
}

function normalizeInputItems(
	items: readonly ResponseItem[],
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): BridgeMessage[] {
	const messages: BridgeMessage[] = [];
	let pendingReasoning: string | undefined;
	for (const item of items) {
		if (item.type === "reasoning") {
			pendingReasoning = appendReasoningText(
				pendingReasoning,
				reasoningText(item),
			);
			continue;
		}
		const itemMessages = normalizeInputItem(item, request, context);
		if (pendingReasoning && itemMessages[0]?.role === "assistant") {
			// Prepend reasoning block to the first assistant message of this item's output.
			itemMessages[0] = {
				...itemMessages[0],
				content: [
					{ type: "reasoning", text: pendingReasoning },
					...itemMessages[0].content,
				],
			};
			pendingReasoning = undefined;
		}
		messages.push(...itemMessages);
	}
	return reorderToolMediaMessages(messages);
}

function reorderToolMediaMessages(
	messages: readonly BridgeMessage[],
): BridgeMessage[] {
	// Move any user messages that carry tool media (inserted by tool-output
	// splitting) out of the middle of a consecutive tool-result run so that
	// Chat Completions providers see assistant -> tool -> tool -> ... before any
	// user turn. Some upstreams (e.g. minimax) reject sequences where a tool
	// result is followed by a non-tool message and then another tool result.
	const result: BridgeMessage[] = [];
	const deferred: BridgeMessage[] = [];
	let inToolRun = false;
	for (const msg of messages) {
		if (isToolResultMessage(msg)) {
			inToolRun = true;
			result.push(msg);
			continue;
		}
		if (inToolRun && isMediaUserMessage(msg)) {
			deferred.push(msg);
			continue;
		}
		if (deferred.length > 0) {
			result.push(...deferred);
			deferred.length = 0;
		}
		inToolRun = false;
		result.push(msg);
	}
	if (deferred.length > 0) result.push(...deferred);
	return result;
}

function isToolResultMessage(msg: BridgeMessage): boolean {
	if (msg.role !== "user") return false;
	return msg.content.some(
		(block) =>
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "tool_result",
	);
}

function isMediaUserMessage(msg: BridgeMessage): boolean {
	if (msg.role !== "user") return false;
	const first = msg.content[0];
	if (first?.type !== "text") return false;
	return first.text.startsWith("[Attached media from tool result");
}

function appendReasoningText(
	current: string | undefined,
	next: string,
): string | undefined {
	if (!next) return current;
	return current ? `${current}\n${next}` : next;
}

function normalizeInputItem(
	item: ResponseItem,
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): BridgeMessage[] {
	if (isSimpleMessageItem(item)) {
		const role: BridgeMessage["role"] =
			item.role === "developer" ? "system" : item.role;
		return [
			{
				role,
				content: normalizeMessageContent(item.content, request, context),
			},
		];
	}
	if (item.type === "function_call") {
		const call = assistantToolUseMessage(
			item.call_id,
			providerToolName(context, "function", toolName(item)),
			item.arguments,
		);
		return call ? [call] : [];
	}
	if (item.type === "function_call_output") {
		const { text, extras } = outputBlocks(item.output, request, context);
		const messages: BridgeMessage[] = [toolResultMessage(item.call_id, text)];
		if (extras.length > 0) {
			messages.push(toolExtrasUserMessage(extras, item.call_id));
		}
		return messages;
	}
	if (item.type === "web_search_call") {
		return webSearchCallToToolMessages(item, context);
	}
	if (item.type === "tool_search_call") {
		return toolSearchCallToToolMessages(item, context);
	}
	if (item.type === "tool_search_output") {
		return toolSearchOutputToToolMessages(item);
	}
	if (item.type === "shell_call") {
		const call = assistantToolUseMessage(
			item.call_id,
			providerToolName(context, "shell", "shell"),
			JSON.stringify(item.action),
		);
		return call ? [call] : [];
	}
	if (item.type === "shell_call_output") {
		return [
			toolResultMessage(
				item.call_id,
				item.output
					.map((chunk) => {
						const outcome =
							chunk.outcome.type === "exit"
								? `exit ${chunk.outcome.exit_code}`
								: chunk.outcome.type;
						return `[${outcome}]\nstdout:\n${chunk.stdout}\nstderr:\n${chunk.stderr}`;
					})
					.join("\n"),
			),
		];
	}
	if (item.type === "local_shell_call") {
		const call = assistantToolUseMessage(
			item.call_id,
			providerToolName(context, "local_shell", "local_shell"),
			JSON.stringify({
				command: item.action.command,
				env: item.action.env,
				...(item.action.timeout_ms !== undefined
					? { timeout_ms: item.action.timeout_ms }
					: {}),
				...(item.action.user !== undefined ? { user: item.action.user } : {}),
				...(item.action.working_directory !== undefined
					? { working_directory: item.action.working_directory }
					: {}),
			}),
		);
		return call ? [call] : [];
	}
	if (item.type === "local_shell_call_output") {
		return [toolResultMessage(item.call_id, item.output)];
	}
	if (item.type === "apply_patch_call") {
		const call = assistantToolUseMessage(
			item.call_id,
			providerToolName(context, "apply_patch", "apply_patch"),
			JSON.stringify({ operation: item.operation }),
		);
		return call ? [call] : [];
	}
	if (item.type === "apply_patch_call_output") {
		return [
			toolResultMessage(
				item.call_id,
				`${item.status}: ${item.output ?? ""}`.trim(),
			),
		];
	}
	if (item.type === "custom_tool_call") {
		const call = assistantToolUseMessage(
			item.call_id,
			providerToolName(context, "custom", toolName(item)),
			JSON.stringify({ input: item.input }),
		);
		return call ? [call] : [];
	}
	if (item.type === "custom_tool_call_output") {
		const { text, extras } = outputBlocks(item.output, request, context);
		const messages: BridgeMessage[] = [toolResultMessage(item.call_id, text)];
		if (extras.length > 0) {
			messages.push(toolExtrasUserMessage(extras, item.call_id));
		}
		return messages;
	}

	throw unsupportedInputItemError(item, request, context);
}

function webSearchCallToToolMessages(
	item: {
		id: string;
		action:
			| {
					type: "search";
					query: string;
					sources?: { type: "url"; url: string }[];
			  }
			| { type: "open_page"; url?: string }
			| { type: "find_in_page"; pattern: string; url: string };
		status: string;
	},
	context: InputNormalizerContext,
): BridgeMessage[] {
	if (!item.id) return [];
	let args: Record<string, unknown>;
	let output: Record<string, unknown>;
	if (item.action.type === "search") {
		args = { query: item.action.query };
		output = {
			status: item.status,
			sources: item.action.sources ?? [],
		};
	} else if (item.action.type === "open_page") {
		args = { action: "open_page", url: item.action.url ?? null };
		output = { status: item.status };
	} else {
		args = {
			action: "find_in_page",
			pattern: item.action.pattern,
			url: item.action.url,
		};
		output = { status: item.status };
	}
	const call = assistantToolUseMessage(
		item.id,
		providerToolName(context, "web_search", "web_search"),
		canonicalizeFunctionArguments(JSON.stringify(args)),
	);
	if (!call) return [];
	return [call, toolResultMessage(item.id, JSON.stringify(output))];
}

function toolSearchCallToToolMessages(
	item: {
		id?: string;
		call_id?: string;
		arguments: unknown;
	},
	context: InputNormalizerContext,
): BridgeMessage[] {
	const callId = item.id ?? item.call_id;
	if (!callId) return [];
	const call = assistantToolUseMessage(
		callId,
		providerToolName(context, "tool_search", "tool_search"),
		canonicalizeFunctionArguments(JSON.stringify(item.arguments ?? {})),
	);
	return call ? [call] : [];
}

function toolSearchOutputToToolMessages(item: {
	id?: string;
	call_id?: string;
	tools: unknown;
	status?: string;
}): BridgeMessage[] {
	const callId = item.call_id ?? item.id;
	if (!callId) return [];
	return [
		toolResultMessage(
			callId,
			JSON.stringify({
				status: item.status,
				tools: item.tools,
			}),
		),
	];
}

function assistantToolUseMessage(
	callId: string,
	name: string,
	argumentsValue: string,
): BridgeMessage | undefined {
	if (!isValidFunctionArguments(argumentsValue)) return undefined;
	const canonical = canonicalizeFunctionArguments(argumentsValue);
	const parsed: unknown = JSON.parse(canonical);
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: callId,
				name,
				input: parsed,
			},
		],
	};
}

function toolResultMessage(callId: string, content: string): BridgeMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: callId,
				content,
			},
		],
	};
}

function toolExtrasUserMessage(
	extras: readonly BridgeContentBlock[],
	callId: string,
): BridgeMessage {
	return {
		role: "user",
		content: [
			{ type: "text", text: `[Attached media from tool result ${callId}]` },
			...extras,
		],
	};
}

function normalizeMessageContent(
	content: unknown,
	request: ResponseCreateRequest,
	context: TextOnlyInputNormalizerContext,
): BridgeContentBlock[];
function normalizeMessageContent(
	content: unknown,
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): BridgeContentBlock[];
function normalizeMessageContent(
	content: unknown,
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): BridgeContentBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) {
		throw unsupportedInputContentError(
			`Unsupported Responses input content type: ${typeof content}`,
			request,
			context,
		);
	}

	const blocks: BridgeContentBlock[] = [];
	for (const part of content) {
		if (isTextPart(part)) {
			blocks.push({ type: "text", text: part.text });
			continue;
		}
		if (isImagePart(part) && context.supportsImageInput) {
			blocks.push(toImageBlock(part));
			continue;
		}
		if (isVideoPart(part) && context.supportsVideoInput) {
			blocks.push(toVideoBlock(part));
			continue;
		}
		throw unsupportedInputContentError(
			`Unsupported Responses input content type: ${contentPartType(part)}`,
			request,
			context,
		);
	}
	return blocks;
}

function isSimpleMessageItem(item: ResponseItem): item is ResponseItem & {
	readonly role: "system" | "user" | "assistant" | "developer";
	readonly content: unknown;
} {
	if (!isRecord(item) || !("role" in item) || !("content" in item)) {
		return false;
	}
	return (
		item.role === "system" ||
		item.role === "user" ||
		item.role === "assistant" ||
		item.role === "developer"
	);
}

function isTextPart(
	part: unknown,
): part is { readonly type: string; readonly text: string } {
	return (
		isRecord(part) &&
		(part.type === "input_text" || part.type === "output_text") &&
		typeof part.text === "string"
	);
}

function isImagePart(part: unknown): part is {
	readonly type: "input_image";
	readonly image_url: string;
	readonly detail?: unknown;
} {
	return (
		isRecord(part) &&
		part.type === "input_image" &&
		typeof part.image_url === "string"
	);
}

function toImageBlock(part: {
	readonly image_url: string;
	readonly detail?: unknown;
}): BridgeContentBlock {
	const detail = imageDetail(part.detail);
	return {
		type: "image",
		url: part.image_url,
		...(detail ? { detail } : {}),
	};
}

type VideoInputPart = {
	readonly type: "input_file";
	readonly detail?: unknown;
} & (
	| { readonly file_url: string; readonly file_data?: string }
	| { readonly file_url?: undefined; readonly file_data: string }
);

function isVideoPart(part: unknown): part is VideoInputPart {
	if (!isRecord(part) || part.type !== "input_file") return false;
	if (typeof part.file_data === "string")
		return isVideoReference(part.file_data);
	if (typeof part.file_url === "string") return isVideoReference(part.file_url);
	return false;
}

function toVideoBlock(part: VideoInputPart): BridgeContentBlock {
	const url = videoUrl(part);
	const detail = videoDetail(part.detail);
	return {
		type: "video",
		url,
		...(detail ? { detail } : {}),
	};
}

function videoUrl(part: VideoInputPart): string {
	if (typeof part.file_url === "string" && isVideoReference(part.file_url))
		return part.file_url;
	if (typeof part.file_data === "string") return part.file_data;
	if (typeof part.file_url === "string") return part.file_url;
	throw new TypeError("Video input part does not contain a video reference.");
}

function imageDetail(value: unknown): "low" | "high" | undefined {
	return value === "low" || value === "high" ? value : undefined;
}

function videoDetail(value: unknown): "low" | "high" | undefined {
	return value === "low" || value === "high" ? value : undefined;
}

const VIDEO_FILE_EXTENSIONS = new Set(["mp4", "avi", "mov", "mkv"]);
function isVideoReference(value: string): boolean {
	if (value.startsWith("data:video/")) return true;
	if (!/^https?:\/\//i.test(value)) return false;
	let pathname: string;
	try {
		pathname = new URL(value).pathname;
	} catch {
		return false;
	}
	const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
	if (!extension) return true;
	return VIDEO_FILE_EXTENSIONS.has(extension);
}

function outputBlocks(
	output: string | readonly unknown[],
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): NormalizedToolOutput {
	if (typeof output === "string") {
		return { text: output, extras: [] };
	}
	const normalized = normalizeMessageContent(output, request, context);
	const textParts: string[] = [];
	const extras: BridgeContentBlock[] = [];
	for (const part of normalized) {
		if (part.type === "text") {
			textParts.push(part.text);
		} else {
			extras.push(part);
		}
	}
	return { text: textParts.join(""), extras };
}

function toolName(item: { name: string; namespace?: string }): string {
	return item.namespace ? `${item.namespace}__${item.name}` : item.name;
}

function providerToolName(
	context: InputNormalizerContext,
	requestedType: string,
	requestedName: string,
): string {
	const declaration = context.toolPlan?.declarations.find(
		(candidate) =>
			candidate.requestedType === requestedType &&
			candidate.requestedName === requestedName,
	);
	return declaration?.providerName ?? requestedName;
}

function reasoningText(
	item: Extract<ResponseItem, { type: "reasoning" }>,
): string {
	return (item.content ?? []).map((part) => part.text).join("");
}

function unsupportedInputItemError(
	item: ResponseItem,
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): BridgeError {
	return new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_INPUT_ITEM,
		`Unsupported Responses input item type for ${provider(context)}: ${inputItemType(item)}.`,
		errorContext(request, context, "input"),
	);
}

function unsupportedInputContentError(
	message: string,
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
): BridgeError {
	return new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_INPUT_CONTENT,
		`${message} for ${provider(context)}.`,
		errorContext(request, context, "input.content"),
	);
}

function inputItemType(item: ResponseItem): string {
	if (isRecord(item) && "type" in item && item.type) return String(item.type);
	return "message";
}

function contentPartType(part: unknown): string {
	if (isRecord(part) && "type" in part) return String(part.type);
	return typeof part;
}

function errorContext(
	request: ResponseCreateRequest,
	context: InputNormalizerContext,
	parameter: string,
): { provider: string; model: string; parameter: string } {
	return {
		provider: provider(context),
		model: context.model ?? requestModel(request),
		parameter,
	};
}

function provider(context: InputNormalizerContext): string {
	return context.provider ?? "bridge";
}

function requestModel(request: ResponseCreateRequest): string {
	return typeof request.model === "string" ? request.model : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
