import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ModelPreset {
	name: string;
	aliases: string[];
	context_window: number;
	max_tokens: number;
	multimodal?: {
		image_input?: boolean;
		audio_input?: boolean;
		video_input?: boolean;
	};
	notes?: string;
}

export interface ModelPresetsConfig {
	version: number;
	match_rules: {
		case_sensitive: boolean;
		strategy_order: string[];
		strip_prefixes: string[];
		strip_suffixes: string[];
	};
	presets: ModelPreset[];
}

let cachedPresets: ModelPresetsConfig | null = null;

export function loadModelPresets(
	configPath?: string,
): ModelPresetsConfig | null {
	if (cachedPresets) return cachedPresets;

	// Try multiple locations for model-presets.json
	const searchPaths = configPath
		? [
				resolve(configPath, "..", "model-presets.json"),
				resolve(configPath, "..", "..", "model-presets.json"),
				resolve(configPath, "..", "..", "..", "model-presets.json"),
			]
		: [];

	// Also check common locations
	const commonPaths = [
		resolve(process.cwd(), "model-presets.json"),
		resolve(process.cwd(), "studio-tauri", "model-presets.json"),
		resolve(__dirname, "..", "..", "studio-tauri", "model-presets.json"),
		resolve(__dirname, "..", "..", "..", "studio-tauri", "model-presets.json"),
	];

	const allPaths = [...searchPaths, ...commonPaths];

	for (const path of allPaths) {
		if (existsSync(path)) {
			try {
				const content = readFileSync(path, "utf-8");
				cachedPresets = JSON.parse(content) as ModelPresetsConfig;
				return cachedPresets;
			} catch {
				// Ignore parse errors
			}
		}
	}

	return null;
}

export function matchModelToPreset(
	model: string,
	presets: ModelPresetsConfig | null,
): ModelPreset | null {
	if (!presets) return null;

	const normalized = presets.match_rules.case_sensitive
		? model
		: model.toLowerCase();

	for (const preset of presets.presets) {
		for (const alias of preset.aliases) {
			const normalizedAlias = presets.match_rules.case_sensitive
				? alias
				: alias.toLowerCase();

			// Exact match
			if (normalized === normalizedAlias) {
				return preset;
			}

			// Contains match
			if (
				presets.match_rules.strategy_order.includes("contains") &&
				normalized.includes(normalizedAlias)
			) {
				return preset;
			}
		}
	}

	return null;
}

export interface ModelMetadata {
	context_window?: number;
	max_tokens?: number;
	notes?: string;
	multimodal?: ModelPreset["multimodal"];
}

export function getModelMetadata(
	model: string,
	presets: ModelPresetsConfig | null,
): ModelMetadata {
	const preset = matchModelToPreset(model, presets);
	if (!preset) return {};

	return {
		context_window: preset.context_window,
		max_tokens: preset.max_tokens,
		notes: preset.notes,
		multimodal: preset.multimodal,
	};
}

export function clearModelPresetsCache(): void {
	cachedPresets = null;
}
