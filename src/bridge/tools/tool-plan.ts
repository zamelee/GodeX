import {
	BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
	BRIDGE_REQUEST_UNSUPPORTED_TOOL,
	BridgeError,
} from "../../error";
import type {
	McpTool,
	ResponseTool,
	ResponseToolChoice,
} from "../../protocol/openai/responses";
import type { McpAllowedTools } from "../../protocol/openai/shared";
import type { ProviderCapabilities } from "../compatibility";
import { buildToolCatalog, type ToolCatalogEntry } from "./tool-catalog";
import {
	isToolChoiceMode,
	renderProviderToolChoice,
	requestedToolChoiceType,
} from "./tool-choice";
import { defaultToolNameCodec } from "./tool-identity";
import { isWebSearchTool, WEB_SEARCH_FUNCTION_NAME } from "./web-search";

export interface ToolPlanningProfile {
	readonly provider: string;
	readonly nativeToolTypes: ReadonlySet<string>;
	readonly degradedToolTypes: ReadonlyMap<string, string>;
	readonly toolChoice: ReadonlySet<string>;
	readonly maxTools?: number;
	readonly toProviderName?: (name: string) => string;
	readonly webSearch?: WebSearchPlanningOptions;
}

export type ToolExecutionMode = "provider" | "godex_managed" | "client";

export interface WebSearchPlanningOptions {
	readonly mode: "auto" | "provider_native" | "godex_managed" | "disabled";
	readonly available: boolean;
	readonly onUnavailable: "client_tool_call" | "fail" | "ignore";
}

export function createToolPlanningProfile(input: {
	readonly provider: string;
	readonly capabilities: ProviderCapabilities;
	readonly toProviderName?: (name: string) => string;
}): ToolPlanningProfile {
	const degraded =
		input.capabilities.tools.degraded ?? new Map<string, string>();
	return {
		provider: input.provider,
		nativeToolTypes: new Set(
			[...input.capabilities.tools.supported].filter(
				(type) => !degraded.has(type),
			),
		),
		degradedToolTypes: degraded,
		toolChoice: input.capabilities.toolChoice.supported,
		maxTools: input.capabilities.tools.maxTools,
		toProviderName: input.toProviderName,
	};
}

export interface ToolDeclarationPlan {
	readonly requestedType: string;
	readonly providerType: string;
	readonly requestedName: string;
	readonly providerName: string;
	readonly tool: ResponseTool;
	readonly execution?: ToolExecutionMode;
}

export interface PlannedToolDecision {
	readonly path: string;
	readonly action: "supported" | "degraded" | "ignored" | "rejected";
	readonly reason: string;
}

export interface ToolPlan {
	readonly enabled: boolean;
	readonly declarations: readonly ToolDeclarationPlan[];
	readonly providerToolChoice?: ResponseToolChoice;
	readonly decisions: readonly PlannedToolDecision[];
}

export function planTools(input: {
	readonly tools?: readonly ResponseTool[];
	readonly toolChoice?: ResponseToolChoice;
	readonly profile: ToolPlanningProfile;
}): ToolPlan {
	const decisions: PlannedToolDecision[] = [];
	if (input.toolChoice === "none") {
		return {
			enabled: false,
			declarations: [],
			providerToolChoice: undefined,
			decisions: [
				{
					path: "tool_choice",
					action: "supported",
					reason: "tool_choice none disables tool declarations.",
				},
			],
		};
	}

	const allocateProviderName = createProviderNameAllocator(
		input.profile.toProviderName ?? defaultToolNameCodec,
	);
	const declarations = buildToolCatalog(input.tools).flatMap((entry) =>
		planToolDeclaration(entry, input.profile, decisions, allocateProviderName),
	);
	assertMaxTools(declarations, input.profile);
	const providerToolChoice = planProviderToolChoice({
		toolChoice: input.toolChoice,
		declarations,
		profile: input.profile,
		decisions,
	});
	return {
		enabled: declarations.length > 0,
		declarations,
		...(providerToolChoice !== undefined ? { providerToolChoice } : {}),
		decisions,
	};
}

function planToolDeclaration(
	entry: ToolCatalogEntry,
	profile: ToolPlanningProfile,
	decisions: PlannedToolDecision[],
	allocateProviderName: (requestedName: string) => string,
): ToolDeclarationPlan[] {
	if (entry.type === "mcp" && entry.tool.type === "mcp") {
		return planMcpToolDeclaration(
			entry,
			profile,
			decisions,
			allocateProviderName,
		);
	}

	if (profile.nativeToolTypes.has(entry.type)) {
		decisions.push({
			path: `tools[type=${entry.type}]`,
			action: "supported",
			reason: `${profile.provider} supports Responses tool '${entry.type}'.`,
		});
		return [
			{
				requestedType: entry.type,
				providerType: entry.type,
				requestedName: entry.name,
				providerName: allocateProviderName(entry.name),
				tool: entry.tool,
			},
		];
	}

	const providerType = profile.degradedToolTypes.get(entry.type);
	if (providerType) {
		decisions.push({
			path: `tools[type=${entry.type}]`,
			action: "degraded",
			reason: `${profile.provider} maps Responses tool '${entry.type}' to provider tool '${providerType}'.`,
		});
		return [
			{
				requestedType: entry.type,
				providerType,
				requestedName: entry.name,
				providerName: allocateProviderName(entry.name),
				tool: entry.tool,
			},
		];
	}

	const webSearchDeclaration = planWebSearchDeclaration(
		entry,
		profile,
		decisions,
		allocateProviderName,
	);
	if (webSearchDeclaration !== null) return webSearchDeclaration;

	decisions.push({
		path: `tools[type=${entry.type}]`,
		action: "ignored",
		reason: `${profile.provider} does not support Responses tool '${entry.type}'; skipping declaration.`,
	});
	return [];
}

function planWebSearchDeclaration(
	entry: ToolCatalogEntry,
	profile: ToolPlanningProfile,
	decisions: PlannedToolDecision[],
	allocateProviderName: (requestedName: string) => string,
): ToolDeclarationPlan[] | null {
	if (!isWebSearchTool(entry.tool) || !profile.webSearch) return null;
	if (
		profile.webSearch.mode === "auto" ||
		profile.webSearch.mode === "godex_managed"
	) {
		if (profile.webSearch.available) {
			decisions.push({
				path: `tools[type=${entry.type}]`,
				action: "degraded",
				reason: `${profile.provider} maps Responses tool '${entry.type}' to GodeX-managed web search.`,
			});
			return [
				webSearchFunctionDeclaration({
					entry,
					execution: "godex_managed",
					allocateProviderName,
				}),
			];
		}
		return unavailableWebSearchDeclaration(
			entry,
			profile,
			decisions,
			allocateProviderName,
		);
	}
	return unavailableWebSearchDeclaration(
		entry,
		profile,
		decisions,
		allocateProviderName,
	);
}

function unavailableWebSearchDeclaration(
	entry: ToolCatalogEntry,
	profile: ToolPlanningProfile,
	decisions: PlannedToolDecision[],
	allocateProviderName: (requestedName: string) => string,
): ToolDeclarationPlan[] {
	const policy = profile.webSearch?.onUnavailable ?? "ignore";
	if (policy === "client_tool_call") {
		decisions.push({
			path: `tools[type=${entry.type}]`,
			action: "degraded",
			reason: `${profile.provider} cannot execute Responses tool '${entry.type}'; returning a client-visible web_search function call.`,
		});
		return [
			webSearchFunctionDeclaration({
				entry,
				execution: "client",
				allocateProviderName,
			}),
		];
	}
	if (policy === "fail") {
		decisions.push({
			path: `tools[type=${entry.type}]`,
			action: "rejected",
			reason: `${profile.provider} cannot execute Responses tool '${entry.type}' and web_search.on_unavailable is fail.`,
		});
		throw new BridgeError(
			BRIDGE_REQUEST_UNSUPPORTED_TOOL,
			`${profile.provider} cannot execute Responses tool '${entry.type}' without a configured web search provider.`,
			{
				provider: profile.provider,
				model: "unknown",
				parameter: "tools",
				toolType: entry.type,
			},
		);
	}
	decisions.push({
		path: `tools[type=${entry.type}]`,
		action: "ignored",
		reason: `${profile.provider} cannot execute Responses tool '${entry.type}'; skipping declaration.`,
	});
	return [];
}

function webSearchFunctionDeclaration(input: {
	readonly entry: ToolCatalogEntry;
	readonly execution: ToolExecutionMode;
	readonly allocateProviderName: (requestedName: string) => string;
}): ToolDeclarationPlan {
	return {
		requestedType: input.entry.type,
		providerType: "function",
		requestedName: input.entry.name,
		providerName: input.allocateProviderName(WEB_SEARCH_FUNCTION_NAME),
		tool: input.entry.tool,
		execution: input.execution,
	};
}

function createProviderNameAllocator(
	toProviderName: (name: string) => string,
): (requestedName: string) => string {
	const usedNames = new Set<string>();
	return (requestedName) => {
		const baseName = toProviderName(requestedName);
		let providerName = baseName;
		let index = 2;
		while (usedNames.has(providerName)) {
			const suffix = `_${index}`;
			providerName = `${baseName.slice(0, 64 - suffix.length)}${suffix}`;
			index += 1;
		}
		usedNames.add(providerName);
		return providerName;
	};
}

function planMcpToolDeclaration(
	entry: ToolCatalogEntry,
	profile: ToolPlanningProfile,
	decisions: PlannedToolDecision[],
	allocateProviderName: (requestedName: string) => string,
): ToolDeclarationPlan[] {
	const tool = entry.tool as McpTool;

	if (profile.nativeToolTypes.has("mcp")) {
		decisions.push({
			path: `tools[type=mcp,server=${tool.server_label}]`,
			action: "supported",
			reason: `${profile.provider} supports Responses tool 'mcp'.`,
		});
		return [
			{
				requestedType: "mcp",
				providerType: "mcp",
				requestedName: tool.server_label,
				providerName: tool.server_label,
				tool,
			},
		];
	}

	const providerType = profile.degradedToolTypes.get("mcp");
	if (providerType !== "function") {
		decisions.push({
			path: `tools[type=mcp,server=${tool.server_label}]`,
			action: "ignored",
			reason: `${profile.provider} does not support Responses tool 'mcp'; skipping declaration.`,
		});
		return [];
	}

	const allowedNames = extractMcpToolNames(tool.allowed_tools);
	if (allowedNames === undefined || allowedNames.length === 0) {
		decisions.push({
			path: `tools[type=mcp,server=${tool.server_label}]`,
			action: "ignored",
			reason: `MCP server '${tool.server_label}' has no allowed_tools or only read_only filter; cannot expand to function declarations.`,
		});
		return [];
	}

	return allowedNames.map((mcpToolName) => {
		const requestedName = `mcp__${tool.server_label}__${mcpToolName}`;
		const providerName = allocateProviderName(requestedName);
		decisions.push({
			path: `tools[type=mcp,server=${tool.server_label},tool=${mcpToolName}]`,
			action: "degraded",
			reason: `${profile.provider} maps MCP tool '${mcpToolName}' on server '${tool.server_label}' to function '${requestedName}'.`,
		});
		return {
			requestedType: "mcp",
			providerType: "function",
			requestedName,
			providerName,
			tool: {
				type: "function",
				name: providerName,
				description: `MCP tool '${mcpToolName}' on server '${tool.server_label}'. Arguments are forwarded as JSON; the MCP server validates them.`,
				parameters: { type: "object", additionalProperties: true },
				strict: false,
			} as ResponseTool,
		};
	});
}
function extractMcpToolNames(
	allowed: McpAllowedTools | undefined,
): string[] | undefined {
	if (allowed === undefined) return undefined;
	if (Array.isArray(allowed)) return allowed;
	if (Array.isArray(allowed.tool_names)) return allowed.tool_names;
	return undefined;
}
function assertMaxTools(
	declarations: readonly ToolDeclarationPlan[],
	profile: ToolPlanningProfile,
): void {
	if (
		profile.maxTools === undefined ||
		declarations.length <= profile.maxTools
	) {
		return;
	}
	throw new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
		`${profile.provider} accepts at most ${profile.maxTools} mapped tools; received ${declarations.length}.`,
		{
			provider: profile.provider,
			model: "unknown",
			parameter: "tools",
			maxTools: profile.maxTools,
			toolCount: declarations.length,
		},
	);
}

function planProviderToolChoice(input: {
	readonly toolChoice?: ResponseToolChoice;
	readonly declarations: readonly ToolDeclarationPlan[];
	readonly profile: ToolPlanningProfile;
	readonly decisions: PlannedToolDecision[];
}): ResponseToolChoice | undefined {
	const toolChoice = input.toolChoice;
	if (toolChoice === undefined || toolChoice === "none") return undefined;
	if (isToolChoiceMode(toolChoice)) {
		return planModeProviderToolChoice(
			toolChoice,
			input.profile,
			input.decisions,
		);
	}

	const requestedType = requestedToolChoiceType(toolChoice);
	const declaration = input.declarations.find((candidate) =>
		toolChoiceMatchesDeclaration(toolChoice, candidate),
	);
	if (!declaration) {
		input.decisions.push({
			path: "tool_choice",
			action: "rejected",
			reason: `Explicit tool_choice cannot be satisfied by provider ${input.profile.provider}.`,
		});
		throw explicitToolChoiceError(input.profile.provider);
	}
	if (!input.profile.toolChoice.has(declaration.providerType)) {
		if (input.profile.toolChoice.has("auto")) {
			input.decisions.push({
				path: "tool_choice",
				action: "degraded",
				reason: `${input.profile.provider} cannot force tool_choice '${requestedType}'; downgraded to auto.`,
			});
			return "auto";
		}
		input.decisions.push({
			path: "tool_choice",
			action: "rejected",
			reason: `Explicit tool_choice cannot be satisfied by provider ${input.profile.provider}.`,
		});
		throw explicitToolChoiceError(input.profile.provider);
	}

	const providerToolChoice = renderProviderToolChoice({
		requested: toolChoice,
		providerType: declaration.providerType,
		providerName: declaration.providerName,
	});
	const action =
		declaration.providerType === requestedType ? "supported" : "degraded";
	input.decisions.push({
		path: "tool_choice",
		action,
		reason:
			action === "supported"
				? `${input.profile.provider} supports tool_choice '${requestedType}'.`
				: `${input.profile.provider} maps tool_choice '${requestedType}' to provider tool_choice '${declaration.providerType}'.`,
	});
	return providerToolChoice;
}

function planModeProviderToolChoice(
	toolChoice: "auto" | "required",
	profile: ToolPlanningProfile,
	decisions: PlannedToolDecision[],
): ResponseToolChoice | undefined {
	if (profile.toolChoice.has(toolChoice)) {
		decisions.push({
			path: "tool_choice",
			action: "supported",
			reason: `${profile.provider} supports tool_choice '${toolChoice}'.`,
		});
		return toolChoice;
	}
	if (profile.toolChoice.has("auto")) {
		decisions.push({
			path: "tool_choice",
			action: "degraded",
			reason: `${profile.provider} does not support tool_choice '${toolChoice}'; downgraded to auto.`,
		});
		return "auto";
	}
	decisions.push({
		path: "tool_choice",
		action: "rejected",
		reason: `Explicit tool_choice cannot be satisfied by provider ${profile.provider}.`,
	});
	throw explicitToolChoiceError(profile.provider);
}

function toolChoiceMatchesDeclaration(
	choice: Exclude<ResponseToolChoice, string>,
	declaration: ToolDeclarationPlan,
): boolean {
	const tool = declaration.tool;
	switch (choice.type) {
		case "function":
		case "custom":
			return "name" in tool && tool.name === choice.name;
		case "mcp":
			return tool.type === "mcp" && tool.server_label === choice.server_label;
		case "shell":
		case "apply_patch":
			return tool.type === choice.type;
		default:
			return tool.type === choice.type;
	}
}

function explicitToolChoiceError(provider: string): BridgeError {
	return new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
		`Explicit tool_choice cannot be satisfied by provider ${provider}.`,
		{
			provider,
			model: "unknown",
			parameter: "tool_choice",
		},
	);
}
