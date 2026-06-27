import { APPLY_PATCH_TOOL_DEFINITION } from "./apply-patch";
import {
	COMPUTER_TOOL_DEFINITION,
	COMPUTER_USE_TOOL_DEFINITION,
} from "./computer-use";
import type {
	BuiltinFunctionToolDefinition,
	BuiltinFunctionToolType,
} from "./definition";
import { LOCAL_SHELL_TOOL_DEFINITION } from "./local-shell";
import { SHELL_TOOL_DEFINITION } from "./shell";
import { TOOL_SEARCH_TOOL_DEFINITION } from "./tool-search";

export const BUILTIN_FUNCTION_TOOL_DEFINITIONS = {
	local_shell: LOCAL_SHELL_TOOL_DEFINITION,
	shell: SHELL_TOOL_DEFINITION,
	apply_patch: APPLY_PATCH_TOOL_DEFINITION,
	tool_search: TOOL_SEARCH_TOOL_DEFINITION,
	computer_use: COMPUTER_USE_TOOL_DEFINITION,
	computer: COMPUTER_TOOL_DEFINITION,
} satisfies Record<BuiltinFunctionToolType, BuiltinFunctionToolDefinition>;
export function isBuiltinFunctionToolType(
	type: string,
): type is BuiltinFunctionToolType {
	return Object.hasOwn(BUILTIN_FUNCTION_TOOL_DEFINITIONS, type);
}

export function getBuiltinFunctionToolDefinition(
	type: string,
): BuiltinFunctionToolDefinition | null {
	return isBuiltinFunctionToolType(type)
		? BUILTIN_FUNCTION_TOOL_DEFINITIONS[type]
		: null;
}
