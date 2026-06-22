import type { ApplicationContext } from "../../context/application-context";
import { loadModelPresets, getModelMetadata } from "../../config/model-presets";

interface ModelInfo {
	slug: string;
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

			return {
				slug: entry.alias,
				display_name: entry.alias,
				visibility: "list",
				context_window: metadata.context_window,
				max_context_window: metadata.context_window,
				auto_compact_token_limit: metadata.max_tokens,
				truncation_policy: {
					mode: "tokens",
					limit: metadata.max_tokens ?? 8192,
				},
				supports_parallel_tool_calls: true,
				supports_image_detail_original: true,
				input_modalities: ["text", "image"],
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
