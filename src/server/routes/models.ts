import { getModelMetadata, loadModelPresets } from "../../config/model-presets";
import type { ApplicationContext } from "../../context/application-context";

interface ModelInfo {
	slug: string;
	id: string;
	name: string;
	description?: string;
	context_window?: number;
	max_context_window?: number;
	full_context_window_limit?: number;
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

			if (!metadata.context_window) {
				app.logger?.warn("models.missing_context_window", () => ({
					model: entry.alias,
					provider: entry.target.provider,
					message: "context_window not found in model-presets.json",
				}));
			}

			const input_modalities: string[] = ["text"];
			if (metadata.multimodal?.image_input) input_modalities.push("image");
			if (metadata.multimodal?.audio_input) input_modalities.push("audio");
			if (metadata.multimodal?.video_input) input_modalities.push("video");
			const supportsImageDetail = metadata.multimodal?.image_input === true;

			const ctxWindow = metadata.context_window ?? 0;
			const maxTokens = metadata.max_tokens ?? 0;
			// Look up margin from godex.yaml models.enabled (margin defaults to 0.95)
			const margin = (app.config.models?.enabled ?? [])
				.find(m => m.model.toLowerCase() === entry.alias.toLowerCase())
				?.margin ?? 0.95;
			const effectiveCtxWindow = Math.floor(ctxWindow * margin);
			const effectiveMaxTokens = Math.floor(maxTokens * margin);
			const compactLimit = Math.max(effectiveCtxWindow - effectiveMaxTokens, 0);

			return {
				slug: entry.alias,
				id: entry.alias,
				name: entry.alias,
				display_name: entry.alias,
				description: metadata.notes,
				visibility: "list",
				context_window: effectiveCtxWindow,
				max_context_window: effectiveCtxWindow,
				full_context_window_limit: compactLimit,
				auto_compact_token_limit: compactLimit,
				truncation_policy: {
					mode: "tokens",
					limit: compactLimit,
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