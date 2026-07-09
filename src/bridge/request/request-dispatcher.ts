import type { ResponseCreateRequest } from "../../protocol/openai/responses";
import type { ResponseSessionSnapshot } from "../../session";
import type { GodexPlugin } from "../plugins";
import type { ProviderSpec } from "../provider-spec";
import { CHAT_COMPLETIONS_PROTOCOL, MESSAGES_PROTOCOL } from "../provider-spec";
import type { ToolPlanningProfile, WebSearchPlanningOptions } from "../tools";
import {
	type BuildAnthropicMessagesRequestInput,
	buildAnthropicMessagesRequest,
} from "./anthropic-messages-builder";
import {
	type BuildChatCompletionRequestInput,
	type BuildChatCompletionRequestResult,
	buildChatCompletionRequest,
} from "./chat-completions-builder";

export interface BuildBridgeRequestInput {
	readonly request: ResponseCreateRequest;
	readonly provider: string;
	readonly model: string;
	readonly spec: ProviderSpec<unknown, unknown, unknown, unknown>;
	readonly profile: ToolPlanningProfile;
	readonly session?: ResponseSessionSnapshot | null;
	readonly plugins?: readonly GodexPlugin[];
	readonly webSearch?: WebSearchPlanningOptions;
}

export interface BuildBridgeRequestResult {
	readonly request: unknown;
	readonly compatibility: ReturnType<
		typeof import("../compatibility").planBridgeCompatibility
	>;
	readonly tools: import("../tools").ToolPlan;
	readonly output: import("../output").OutputContractPlan;
}

/**
 * Dispatch a Responses-shaped input to the upstream-protocol-specific
 * request builder. Reads `spec.protocol`:
 *   - `chat_completions` (or absent) -> `buildChatCompletionRequest`
 *   - `messages` -> `buildAnthropicMessagesRequest` (Phase B stub)
 *   - anything else -> falls back to chat_completions
 *
 * Fallback policy (locked-in decision, handoff Round 10 + Round 12):
 * existing 6 specs all declare `chat_completions` explicitly, so the
 * fallback path is dormant today. It activates only if a future spec
 * forgets to set `protocol`, or if the YAML loader injects a spec
 * without one. Trace integration of the fallback marker is deferred to
 * a later step (the dispatcher runs in a context that does not always
 * have a ResponsesContext, so the trace call must be threaded through
 * the call site).
 */
export async function buildBridgeRequest(
	input: BuildBridgeRequestInput,
): Promise<BuildBridgeRequestResult> {
	const chatInput: BuildChatCompletionRequestInput = {
		request: input.request,
		provider: input.provider,
		model: input.model,
		capabilities: input.spec.capabilities,
		profile: input.profile,
		session: input.session,
		plugins: input.plugins,
		webSearch: input.webSearch,
	};

	if (input.spec.protocol === MESSAGES_PROTOCOL) {
		const anthropicInput: BuildAnthropicMessagesRequestInput = chatInput;
		return buildAnthropicMessagesRequest(anthropicInput);
	}

	// protocol === undefined OR protocol === CHAT_COMPLETIONS_PROTOCOL OR unknown -> chat
	const built: BuildChatCompletionRequestResult =
		await buildChatCompletionRequest(chatInput);
	return built;
}

export const __FALLBACK_PROTOCOL = CHAT_COMPLETIONS_PROTOCOL;
