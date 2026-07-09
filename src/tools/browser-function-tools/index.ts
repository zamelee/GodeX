/**
 * Public surface for Path D browser function tools.
 *
 * Modules:
 * - `./declarations` — the 13 Path D tool specs and Responses API declarations
 * - `./executor` — HTTP proxy that turns a `function_call` into a
 *   `function_call_output` by calling the chrome-browser-mcp streamable_http
 *   server
 */
export {
	asResponseTools,
	BROWSER_FUNCTION_TOOLS,
	type BrowserFunctionCallSpec,
	browserMcpToolName,
	buildBrowserFunctionDeclarations,
	GODEX_CHROME_PREFIX,
	isGodexChromeFunctionName,
} from "./declarations";
export {
	BrowserFunctionExecutionError,
	executeBrowserFunctionCall,
	getBrowserMcpEndpoint,
	isBrowserFunctionCall,
	setBrowserMcpEndpointForTesting,
} from "./executor";
