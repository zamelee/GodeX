import type {
	ApplyPatchOperation,
	ComputerAction,
	ComputerCall,
	CustomToolCall,
	LocalShellCall,
	ResponseItem,
	ShellCall,
	ToolSearchCall,
	WebSearchCall,
} from "../../protocol/openai/responses";
import type { ItemStatus } from "../../protocol/openai/shared";
import type { ToolIdentityMap } from "./tool-identity";

export interface ProviderFunctionCall {
	readonly callId: string;
	readonly name: string;
	readonly arguments: string;
}

export function restoreToolCall(
	call: ProviderFunctionCall,
	identities: ToolIdentityMap,
): ResponseItem {
	const identity = identities.get(call.name);
	if (identity?.requestedType === "local_shell") {
		return (
			localShellCall(call) ?? fallbackFunctionCall(call, identity.requestedName)
		);
	}
	if (identity?.requestedType === "shell") {
		return (
			shellCall(call) ?? fallbackFunctionCall(call, identity.requestedName)
		);
	}
	if (identity?.requestedType === "apply_patch") {
		return (
			applyPatchCall(call) ?? fallbackFunctionCall(call, identity.requestedName)
		);
	}
	if (identity?.requestedType === "tool_search") {
		return toolSearchCall(call);
	}
	if (identity?.requestedType === "web_search") {
		return (
			webSearchCall(call) ?? fallbackFunctionCall(call, identity.requestedName)
		);
	}
	if (
		identity?.requestedType === "computer_use" ||
		identity?.requestedType === "computer"
	) {
		return (
			computerCall(call) ?? fallbackFunctionCall(call, identity.requestedName)
		);
	}
	if (identity?.requestedType === "custom") {
		return (
			customToolCall(call, identity.requestedName) ??
			fallbackFunctionCall(call, identity.requestedName)
		);
	}
	return fallbackFunctionCall(call, identity?.requestedName ?? call.name);
}

function fallbackFunctionCall(
	call: ProviderFunctionCall,
	name: string,
): ResponseItem {
	return {
		type: "function_call",
		call_id: call.callId,
		name,
		arguments: call.arguments,
	};
}

function localShellCall(call: ProviderFunctionCall): LocalShellCall | null {
	const parsed = parsedRecord(call.arguments);
	if (!parsed) return null;
	const command = parsed.cmd ?? parsed.command;
	if (!isStringArray(command)) return null;

	const action: LocalShellCall["action"] = {
		type: "exec",
		command,
		env: stringRecord(parsed.env),
	};
	const timeoutMs = optionalNumber(parsed.timeout_ms);
	if (timeoutMs !== undefined) action.timeout_ms = timeoutMs;
	const user = optionalString(parsed.user);
	if (user !== undefined) action.user = user;
	const workingDirectory = optionalString(parsed.working_directory);
	if (workingDirectory !== undefined)
		action.working_directory = workingDirectory;

	return {
		id: call.callId,
		type: "local_shell_call",
		call_id: call.callId,
		action,
		status: "in_progress",
	};
}

function shellCall(call: ProviderFunctionCall): ShellCall | null {
	const parsed = parsedRecord(call.arguments);
	if (!parsed || !isStringArray(parsed.commands)) return null;

	const action: ShellCall["action"] = { commands: parsed.commands };
	const timeoutMs = optionalNumber(parsed.timeout_ms);
	if (timeoutMs !== undefined) action.timeout_ms = timeoutMs;
	const maxOutputLength = optionalNumber(parsed.max_output_length);
	if (maxOutputLength !== undefined) action.max_output_length = maxOutputLength;

	return {
		type: "shell_call",
		call_id: call.callId,
		action,
		status: "in_progress",
	};
}

function applyPatchCall(call: ProviderFunctionCall): ResponseItem | null {
	const parsed = parsedRecord(call.arguments);
	if (!parsed || !isApplyPatchOperation(parsed.operation)) return null;
	return {
		type: "apply_patch_call",
		call_id: call.callId,
		operation: parsed.operation,
		status: "in_progress",
	};
}

function toolSearchCall(call: ProviderFunctionCall): ToolSearchCall {
	const parsed = parsedRecord(call.arguments);
	return {
		id: call.callId,
		type: "tool_search_call",
		call_id: call.callId,
		arguments: parsed ?? call.arguments,
		execution: "client",
		status: "in_progress",
	};
}

function webSearchCall(call: ProviderFunctionCall): WebSearchCall | null {
	const parsed = parsedRecord(call.arguments);
	if (!parsed) return null;
	// Detect the web_search action from the argument shape.
	// The upstream model picks an action by populating one of three fields:
	//   - query          -> search
	//   - url only       -> open_page
	//   - url + pattern  -> find_in_page
	const query = optionalString(parsed.query);
	const url = optionalString(parsed.url);
	const pattern = optionalString(parsed.pattern);
	if (url !== undefined && pattern !== undefined) {
		return {
			id: call.callId,
			type: "web_search_call",
			action: { type: "find_in_page", url, pattern },
			status: "in_progress",
		};
	}
	if (url !== undefined) {
		return {
			id: call.callId,
			type: "web_search_call",
			action: { type: "open_page", url },
			status: "in_progress",
		};
	}
	if (query !== undefined) {
		return {
			id: call.callId,
			type: "web_search_call",
			action: { type: "search", query },
			status: "in_progress",
		};
	}
	return null;
}

function computerCall(call: ProviderFunctionCall): ComputerCall | null {
	const parsed = parsedRecord(call.arguments);
	if (!parsed) return null;
	const actionName = optionalString(parsed.action);
	if (!actionName) return null;
	const action = mapComputerAction(actionName, parsed);
	if (!action) return null;

	const status: ItemStatus = "in_progress";
	return {
		id: call.callId,
		type: "computer_call",
		call_id: call.callId,
		pending_safety_checks: [],
		status,
		action,
	};
}

function mapComputerAction(
	name: string,
	parsed: Record<string, unknown>,
): ComputerAction | null {
	switch (name) {
		case "screenshot":
			return { type: "screenshot" };
		case "wait":
			return { type: "wait" };
		case "click":
			return clickAction(parsed);
		case "double_click":
			return doubleClickAction(parsed);
		case "type":
			return typeAction(parsed);
		case "keypress":
			return keypressAction(parsed);
		case "scroll":
			return scrollAction(parsed);
		case "move":
			return moveAction(parsed);
		case "drag":
			return dragAction(parsed);
		default:
			return null;
	}
}

function clickAction(parsed: Record<string, unknown>): ComputerAction | null {
	const x = optionalNumber(parsed.x);
	const y = optionalNumber(parsed.y);
	if (x === undefined || y === undefined) return null;
	const buttonRaw = optionalString(parsed.button);
	const button = isClickButton(buttonRaw) ? buttonRaw : "left";
	const keys = optionalStringArray(parsed.keys);
	const action = {
		type: "click" as const,
		x,
		y,
		button,
		...(keys ? { keys } : {}),
	};
	return action;
}

function doubleClickAction(
	parsed: Record<string, unknown>,
): ComputerAction | null {
	const x = optionalNumber(parsed.x);
	const y = optionalNumber(parsed.y);
	if (x === undefined || y === undefined) return null;
	const keys = optionalStringArray(parsed.keys) ?? [];
	return { type: "double_click", x, y, keys };
}

function typeAction(parsed: Record<string, unknown>): ComputerAction | null {
	const text = optionalString(parsed.text);
	if (text === undefined) return null;
	return { type: "type", text };
}

function keypressAction(
	parsed: Record<string, unknown>,
): ComputerAction | null {
	const keys = optionalStringArray(parsed.keys);
	if (!keys || keys.length === 0) return null;
	return { type: "keypress", keys };
}

function scrollAction(parsed: Record<string, unknown>): ComputerAction | null {
	const x = optionalNumber(parsed.x);
	const y = optionalNumber(parsed.y);
	const scrollX = optionalNumber(parsed.scroll_x) ?? 0;
	const scrollY = optionalNumber(parsed.scroll_y) ?? 0;
	if (x === undefined || y === undefined) return null;
	const keys = optionalStringArray(parsed.keys);
	const action = {
		type: "scroll" as const,
		scroll_x: scrollX,
		scroll_y: scrollY,
		x,
		y,
		...(keys ? { keys } : {}),
	};
	return action;
}

function moveAction(parsed: Record<string, unknown>): ComputerAction | null {
	const x = optionalNumber(parsed.x);
	const y = optionalNumber(parsed.y);
	if (x === undefined || y === undefined) return null;
	const keys = optionalStringArray(parsed.keys);
	const action = {
		type: "move" as const,
		x,
		y,
		...(keys ? { keys } : {}),
	};
	return action;
}

function dragAction(parsed: Record<string, unknown>): ComputerAction | null {
	const path = parseDragPath(parsed.path);
	if (!path || path.length === 0) return null;
	const keys = optionalStringArray(parsed.keys);
	const action = {
		type: "drag" as const,
		path,
		...(keys ? { keys } : {}),
	};
	return action;
}

function parseDragPath(value: unknown): { x: number; y: number }[] | null {
	if (!Array.isArray(value)) return null;
	const result: { x: number; y: number }[] = [];
	for (const point of value) {
		if (!isRecord(point)) return null;
		const x = optionalNumber(point.x);
		const y = optionalNumber(point.y);
		if (x === undefined || y === undefined) return null;
		result.push({ x, y });
	}
	return result;
}

function isClickButton(
	value: string | undefined,
): value is "left" | "right" | "wheel" | "back" | "forward" {
	return (
		value === "left" ||
		value === "right" ||
		value === "wheel" ||
		value === "back" ||
		value === "forward"
	);
}

function customToolCall(
	call: ProviderFunctionCall,
	name: string,
): CustomToolCall | null {
	const parsed = parsedRecord(call.arguments);
	const input = optionalString(parsed?.input);
	if (input === undefined) return null;
	return {
		type: "custom_tool_call",
		call_id: call.callId,
		name,
		input,
	};
}

function parsedRecord(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function stringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") result[key] = item;
	}
	return result;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	if (!value.every((item) => typeof item === "string")) return undefined;
	return value as string[];
}

function isApplyPatchOperation(value: unknown): value is ApplyPatchOperation {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (typeof value.path !== "string") return false;
	switch (value.type) {
		case "create_file":
		case "update_file":
			return typeof value.diff === "string";
		case "delete_file":
			return true;
		default:
			return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}
