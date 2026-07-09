import type {
	FunctionTool,
	ResponseTool,
} from "../../protocol/openai/responses";

/**
 * Path D: GodeX-internal function tools for browser automation.
 *
 * These tools are declared to the upstream Chat Completions provider as
 * ordinary `function` tools. The bridge intercepts `function_call` items whose
 * `name` matches `GODEX_CHROME_PREFIX` and executes them locally against the
 * chrome-browser-mcp streamable_http server (default `http://127.0.0.1:9224/mcp`)
 * instead of returning them to the Codex client for execution.
 *
 * The prefix avoids collision with Codex built-in `chrome_*` names and with
 * the upstream `mcp__chrome_devtools__*` MCP namespace.
 */
export const GODEX_CHROME_PREFIX = "godex_chrome_";

export interface BrowserFunctionCallSpec {
	readonly providerName: string;
	readonly mcpToolName: string;
	readonly description: string;
}

export const BROWSER_FUNCTION_TOOLS: readonly BrowserFunctionCallSpec[] = [
	{
		providerName: `${GODEX_CHROME_PREFIX}list_pages`,
		mcpToolName: "list_pages",
		description:
			"List all open browser tabs. Returns a JSON array with each tab's id, url, and title. Use this before switching tabs or navigating.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}get_active_tab`,
		mcpToolName: "get_active_tab",
		description:
			"Get the currently focused tab. Returns the active tab's id, url, and title.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}switch_tab`,
		mcpToolName: "switch_tab",
		description:
			"Switch to a different tab by URL pattern (exact match or substring). Use after list_pages to claim a tab by its visible URL.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}navigate`,
		mcpToolName: "navigate",
		description:
			"Navigate the current tab to a new URL. Replaces the current page; do not call when the page has unsaved input the user cares about.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}open_url`,
		mcpToolName: "open_url",
		description: "Open a URL in a new browser tab.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}screenshot`,
		mcpToolName: "screenshot",
		description:
			"Take a screenshot of the current page. Returns a PNG image you can describe to the user.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}click`,
		mcpToolName: "click",
		description:
			"Click an element on the current page by CSS selector. Prefer unique selectors; if the click target is ambiguous, take a snapshot first.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}type_text`,
		mcpToolName: "type_text",
		description:
			"Type text into an input field identified by CSS selector. Use after focusing the input; use click first if the field is not already focused.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}get_text`,
		mcpToolName: "get_text",
		description: "Read the visible text of an element by CSS selector.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}wait_for`,
		mcpToolName: "wait_for",
		description:
			"Wait up to timeout milliseconds (default 15000) for a CSS selector to appear on the current page. Use after clicks or navigation that change the DOM.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}evaluate`,
		mcpToolName: "evaluate",
		description:
			"Run a JavaScript expression in the current page and return its stringified result. Use only for read-only inspection; mutations should go through click or type_text.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}scroll_to`,
		mcpToolName: "scroll_to",
		description: "Scroll an element into view by CSS selector.",
	},
	{
		providerName: `${GODEX_CHROME_PREFIX}get_element_info`,
		mcpToolName: "get_element_info",
		description:
			"Return element metadata (bounding box, visibility, text) for a CSS selector. Useful before clicking or screenshotting.",
	},
] as const;

export function isGodexChromeFunctionName(name: string): boolean {
	return name.startsWith(GODEX_CHROME_PREFIX);
}

export function browserMcpToolName(providerName: string): string | undefined {
	if (!isGodexChromeFunctionName(providerName)) return undefined;
	const entry = BROWSER_FUNCTION_TOOLS.find(
		(spec) => spec.providerName === providerName,
	);
	return entry?.mcpToolName;
}

export function buildBrowserFunctionDeclarations(): FunctionTool[] {
	return BROWSER_FUNCTION_TOOLS.map(buildBrowserFunctionDeclaration);
}

function buildBrowserFunctionDeclaration(
	spec: BrowserFunctionCallSpec,
): FunctionTool {
	const parameters = toolSchema(spec.mcpToolName);
	return {
		type: "function",
		name: spec.providerName,
		description: spec.description,
		parameters,
		strict: false,
	};
}

function toolSchema(mcpName: string): FunctionTool["parameters"] {
	switch (mcpName) {
		case "list_pages":
		case "get_active_tab":
		case "screenshot":
			return { type: "object", properties: {}, additionalProperties: false };
		case "navigate":
		case "open_url":
			return {
				type: "object",
				properties: {
					url: { type: "string", description: "Absolute URL (http/https)." },
				},
				required: ["url"],
				additionalProperties: false,
			};
		case "switch_tab":
			return {
				type: "object",
				properties: {
					url_pattern: {
						type: "string",
						description: "Exact URL or substring to match.",
					},
				},
				required: ["url_pattern"],
				additionalProperties: false,
			};
		case "click":
		case "get_text":
		case "scroll_to":
		case "get_element_info":
			return {
				type: "object",
				properties: {
					selector: { type: "string", description: "CSS selector." },
				},
				required: ["selector"],
				additionalProperties: false,
			};
		case "type_text":
			return {
				type: "object",
				properties: {
					selector: { type: "string", description: "CSS selector." },
					text: { type: "string", description: "Text to type." },
				},
				required: ["selector", "text"],
				additionalProperties: false,
			};
		case "wait_for":
			return {
				type: "object",
				properties: {
					selector: { type: "string", description: "CSS selector." },
					timeout: {
						type: "number",
						description: "Timeout in milliseconds (default 15000).",
					},
				},
				required: ["selector"],
				additionalProperties: false,
			};
		case "evaluate":
			return {
				type: "object",
				properties: {
					js: {
						type: "string",
						description: "JavaScript expression to evaluate in the page.",
					},
				},
				required: ["js"],
				additionalProperties: false,
			};
		default:
			return { type: "object", properties: {}, additionalProperties: true };
	}
}

export function asResponseTools(): ResponseTool[] {
	return buildBrowserFunctionDeclarations();
}
