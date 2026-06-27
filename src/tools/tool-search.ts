import type { BuiltinFunctionToolDefinition } from "./definition";

export const TOOL_SEARCH_TOOL_DEFINITION: BuiltinFunctionToolDefinition = {
	name: "tool_search",
	description:
		"Searches over deferred tool metadata with BM25 and exposes matching tools for the next model call. Use this to discover available MCP and built-in tools.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Search query for the tool name or description.",
			},
			limit: {
				type: "number",
				description: "Maximum number of tools to return.",
			},
		},
		required: ["query"],
	},
};
