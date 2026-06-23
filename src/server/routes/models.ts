import type { ApplicationContext } from "../../context/application-context";
import { loadModelPresets, getModelMetadata } from "../../config/model-presets";

interface ModelInfo {
	slug: string;
	// id/name are emitted alongside slug so Codex++`s parse_model_payload (which only
	// recognizes id/model/name) can enumerate the model list. slug is kept for codex.
	id: string;
	name: string;
	description?: string;
	context_window?: number;
	max_context_window?: number;
	auto_compact_token_limit?: number;
	truncation_policy?: { mode: string; limit: number };
	supports_parallel_tool_calls?: boolean;
	supports_image_detail_original?: boolean;
	input_modalities?: string[];
	supported_reasoning_levels?: { effort: string; description: string }[];
	supported_in_api?: boolean;
	visibility?: string;
	display_name?: string;
	default_reasoning_level?: string;
}

export function handleModels(app: ApplicationContext): Response {
	const presets = loadModelPresets(app.configPath);

	const models: ModelInfo[] = app.resolver
		.listAliases(app.registrar.list())
		.map((entry) => {
			const metadata = getModelMetadata(entry.alias, presets);

			// Log warning if context_window not found
			if (!metadata.context_window) {
				app.logger?.warn("models.missing_context_window", () => ({
					model: entry.alias,
					provider: entry.target.provider,
					message: "context_window not found in model-presets.json",
				}));
			}

			// Derive input_modalities from preset.multimodal. Unknown models default
			// to text-only (more conservative than the previous hardcoded ["text","image"]).
			const input_modalities: string[] = ["text"];
			if (metadata.multimodal?.image_input) input_modalities.push("image");
			if (metadata.multimodal?.audio_input) input_modalities.push("audio");
			if (metadata.multimodal?.video_input) input_modalities.push("video");
			const supportsImageDetail = metadata.multimodal?.image_input === true;

			return {
				slug: entry.alias,
				id: entry.alias,
				name: entry.alias,
				display_name: entry.alias,
				description: metadata.notes,
				visibility: "list",
				context_window: metadata.context_window,
				max_context_window: metadata.context_window,
				auto_compact_token_limit: metadata.max_tokens,
				truncation_policy: {
					mode: "tokens",
					limit: metadata.max_tokens ?? 8192,
				},
				supports_parallel_tool_calls: true,
				supports_image_detail_original: supportsImageDetail,
				input_modalities,
				supported_reasoning_levels: [
					{ effort: "low", description: "Fast responses with lighter reasoning" },
					{ effort: "medium", description: "Balances speed and reasoning depth" },
					{ effort: "high", description: "Greater reasoning depth for complex problems" },
				],
				supported_in_api: true,
			};
		});

	return Response.json({ models });
}