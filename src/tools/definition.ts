export type BuiltinFunctionToolType =
	| "local_shell"
	| "shell"
	| "apply_patch"
	| "tool_search"
	| "computer_use"
	| "computer";

export interface BuiltinFunctionToolParameters {
	type: "object";
	properties: Record<string, Record<string, unknown>>;
	required?: string[];
	[key: string]: unknown;
}

export interface BuiltinFunctionToolDefinition {
	readonly name: BuiltinFunctionToolType;
	readonly description: string;
	readonly parameters: BuiltinFunctionToolParameters;
}
