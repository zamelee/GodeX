import type {
	FileSearchTool,
	McpTool,
	ResponseTool,
	WebSearchPreviewTool,
	WebSearchTool,
} from "../../protocol/openai/responses";
import { getBuiltinFunctionToolDefinition } from "../../tools";
import {
	degradedCustomToolDescription,
	degradedCustomToolParameters,
} from "./custom-tool-degradation";
import type { ToolDeclarationPlan } from "./tool-plan";

export interface ChatFunctionToolDeclaration {
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly description?: string;
		readonly parameters: Record<string, unknown>;
		readonly strict?: boolean;
	};
}

export type ProviderToolDeclaration =
	| ChatFunctionToolDeclaration
	| { readonly [key: string]: unknown };

export function renderProviderToolDeclarations(
	plans: readonly ToolDeclarationPlan[],
): ProviderToolDeclaration[] {
	return plans
		.map((plan) => providerToolDeclaration(plan))
		.filter((declaration) => declaration !== undefined);
}

export function renderFunctionDeclarations(
	plans: readonly ToolDeclarationPlan[],
): ChatFunctionToolDeclaration[] {
	return plans
		.filter((plan) => plan.providerType === "function")
		.map((plan) => functionDeclaration(plan.tool, plan.providerName));
}

function providerToolDeclaration(
	plan: ToolDeclarationPlan,
): ProviderToolDeclaration | undefined {
	switch (plan.providerType) {
		case "function":
			return functionDeclaration(plan.tool, plan.providerName);
		case "web_search":
			return webSearchDeclaration(plan.tool, plan.providerType);
		case "retrieval":
			return retrievalDeclaration(plan.tool);
		case "mcp":
			return mcpDeclaration(plan.tool);
		default:
			return undefined;
	}
}

function functionDeclaration(
	tool: ResponseTool,
	providerName: string,
): ChatFunctionToolDeclaration {
	if (tool.type === "function") {
		return {
			type: "function",
			function: {
				name: providerName,
				...(tool.description ? { description: tool.description } : {}),
				parameters: tool.parameters,
				strict: tool.strict,
			},
		};
	}
	if (tool.type === "custom") {
		return {
			type: "function",
			function: {
				name: providerName,
				description: degradedCustomToolDescription(tool),
				parameters: degradedCustomToolParameters(tool),
			},
		};
	}
	const builtinDefinition = getBuiltinFunctionToolDefinition(tool.type);
	if (builtinDefinition) {
		return {
			type: "function",
			function: {
				name: providerName,
				description: builtinDefinition.description,
				parameters: builtinDefinition.parameters,
			},
		};
	}
	return {
		type: "function",
		function: {
			name: providerName,
			parameters: genericObjectSchema(),
		},
	};
}

function webSearchDeclaration(
	tool: ResponseTool,
	providerType: string,
): ProviderToolDeclaration | undefined {
	if (!isWebSearchTool(tool)) return undefined;
	// Native rendering: Zhipu, DeepSeek, etc. have a dedicated web_search tool
	// type in their API. Pass the standard fields through unchanged.
	if (providerType === "web_search") {
		return {
			type: "web_search",
			web_search: {
				enable: true,
				search_engine: "search_std",
				content_size: tool.search_context_size === "high" ? "high" : "medium",
			},
		};
	}
	// Degraded rendering (providerType === "function"): minimax and similar
	// providers do not have a native web_search tool, so we render the tool as
	// a generic function. We include the full parameter schema for all three
	// Codex web_search actions (search / open_page / find_in_page) so the
	// model knows how to invoke each. The call-restorer detects the action
	// from the argument shape and reconstructs the original web_search_call.
	return {
		type: "function",
		function: {
			name: "web_search",
			description:
				"Search the web or open a specific URL.\n" +
				'- To search the web: pass {"query": "<search terms>"}.\n' +
				'- To open a URL: pass {"url": "<https://...>"}.\n' +
				'- To find text on a page: pass {"url": "<https://...>", "pattern": "<text>"}.\n',
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search query (for the search action)",
					},
					url: {
						type: "string",
						description:
							"URL to open (for the open_page or find_in_page action)",
					},
					pattern: {
						type: "string",
						description:
							"Text pattern to find on the page (for the find_in_page action)",
					},
				},
				required: [],
			},
		},
	};
}

function retrievalDeclaration(
	tool: ResponseTool,
): ProviderToolDeclaration | undefined {
	if (!isFileSearchTool(tool)) return undefined;
	const [knowledgeId] = tool.vector_store_ids;
	if (!knowledgeId) return undefined;
	return {
		type: "retrieval",
		retrieval: {
			knowledge_id: knowledgeId,
		},
	};
}

function mcpDeclaration(
	tool: ResponseTool,
): ProviderToolDeclaration | undefined {
	if (!isMcpTool(tool)) return undefined;
	return {
		type: "mcp",
		mcp: {
			server_label: tool.server_label,
			...(tool.server_url ? { server_url: tool.server_url } : {}),
			...(tool.allowed_tools ? { allowed_tools: tool.allowed_tools } : {}),
			...(tool.headers ? { headers: tool.headers } : {}),
		},
	};
}

function genericObjectSchema(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: true,
	};
}

function isWebSearchTool(
	tool: ResponseTool,
): tool is WebSearchTool | WebSearchPreviewTool {
	return (
		tool.type === "web_search" ||
		tool.type === "web_search_2025_08_26" ||
		tool.type === "web_search_preview" ||
		tool.type === "web_search_preview_2025_03_11"
	);
}

function isFileSearchTool(tool: ResponseTool): tool is FileSearchTool {
	return tool.type === "file_search";
}

function isMcpTool(tool: ResponseTool): tool is McpTool {
	return tool.type === "mcp";
}
