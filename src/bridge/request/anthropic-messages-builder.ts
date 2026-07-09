import { BRIDGE_REQUEST_UNSUPPORTED_PARAMETER, BridgeError } from "../../error";
import type { ResponseCreateRequest } from "../../protocol/openai/responses";
import type { ResponseSessionSnapshot } from "../../session";
import type { ProviderCapabilities } from "../compatibility";
import type { OutputContractPlan } from "../output";
import type {
	ToolPlan,
	ToolPlanningProfile,
	WebSearchPlanningOptions,
} from "../tools";

export interface BuildAnthropicMessagesRequestInput {
	readonly request: ResponseCreateRequest;
	readonly provider: string;
	readonly model: string;
	readonly capabilities: ProviderCapabilities;
	readonly profile: ToolPlanningProfile;
	readonly session?: ResponseSessionSnapshot | null;
	readonly plugins?: readonly unknown[];
	readonly webSearch?: WebSearchPlanningOptions;
}

export interface BuildAnthropicMessagesRequestResult {
	/** Anthropic Messages request body. Shape defined in Phase B. */
	readonly request: unknown;
	readonly compatibility: ReturnType<
		typeof import("../compatibility").planBridgeCompatibility
	>;
	readonly tools: ToolPlan;
	readonly output: OutputContractPlan;
}

/**
 * Anthropic Messages request builder. Stub for Phase A step 4.
 * Real implementation lands in Phase B alongside the Anthropic provider.
 *
 * Until then, any provider configured with `protocol: MESSAGES_PROTOCOL`
 * (or any spec that falls back to messages via the dispatcher) will hit
 * this stub and surface a clear "Phase B not implemented" error rather
 * than silently mis-routing to the Chat pipeline.
 */
export async function buildAnthropicMessagesRequest(
	input: BuildAnthropicMessagesRequestInput,
): Promise<BuildAnthropicMessagesRequestResult> {
	throw new BridgeError(
		BRIDGE_REQUEST_UNSUPPORTED_PARAMETER,
		`AnthropicMessages request builder is not implemented yet. Phase B will fill this in. Provider=${input.provider}, model=${input.model}.`,
		{
			provider: input.provider,
			model: input.model,
			parameter: "spec.protocol",
			value: "messages",
		},
	);
}
