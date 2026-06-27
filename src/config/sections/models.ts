import { asConfigObject, createConfigMap } from "../raw";
import type { EnabledModel, ModelCapabilities, ModelsConfig } from "../schema";

export function parseModelsConfig(
	raw: unknown,
	providerNames: Set<string>,
): ModelsConfig | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;

	const rawModels = asConfigObject(raw);
	const rawAliases =
		typeof rawModels.aliases === "object" && rawModels.aliases !== null
			? (rawModels.aliases as Record<string, unknown>)
			: undefined;
	const rawEnabled = Array.isArray(rawModels.enabled)
		? (rawModels.enabled as unknown[])
		: undefined;

	if (!rawAliases && !rawEnabled) return undefined;

	// Validate user aliases first so the test can use explicit "<provider>/<model>" overrides.
	const userAliases = rawAliases
		? validateModelAliases(rawAliases, providerNames)
		: {};

	const enabled = rawEnabled
		? parseEnabledModels(rawEnabled, providerNames)
		: undefined;
	if (enabled && enabled.length > 0) {
		for (const item of enabled) {
			const alias = `${item.provider}/${item.model}`;
			// explicit user aliases win
			if (!(alias in userAliases)) {
				userAliases[alias] = alias;
			}
		}
	}

	return { aliases: userAliases, enabled };
}

function parseEnabledModels(
	raw: unknown[],
	providerNames: Set<string>,
): EnabledModel[] {
	const out: EnabledModel[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i];
		if (typeof item !== "object" || item === null) {
			throw new Error(`models.enabled[${i}] must be an object`);
		}
		const obj = item as Record<string, unknown>;
		const provider = typeof obj.provider === "string" ? obj.provider : "";
		const model = typeof obj.model === "string" ? obj.model : "";
		if (!provider || !model) {
			throw new Error(
				`models.enabled[${i}] must have string provider and model`,
			);
		}
		if (!providerNames.has(provider)) {
			throw new Error(
				"models.enabled[" +
					i +
					']: provider "' +
					provider +
					'" is not configured',
			);
		}
		const contextWindow = numberOrUndefined(obj.context_window);
		const maxTokens = numberOrUndefined(obj.max_tokens);
		const margin = numberOrUndefined(obj.margin);
		const multimodal = boolOrUndefined(obj.multimodal);
		const capabilities = parseCapabilities(obj.capabilities);
		const note = typeof obj.note === "string" ? obj.note : undefined;
		const entry: EnabledModel = { provider, model };
		if (contextWindow !== undefined) entry.context_window = contextWindow;
		if (maxTokens !== undefined) entry.max_tokens = maxTokens;
		if (margin !== undefined) entry.margin = margin;
		if (multimodal !== undefined) entry.multimodal = multimodal;
		if (capabilities) entry.capabilities = capabilities;
		if (note !== undefined) entry.note = note;
		out.push(entry);
	}
	return out;
}

function parseCapabilities(raw: unknown): ModelCapabilities | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const obj = raw as Record<string, unknown>;
	const cap: ModelCapabilities = {};
	let any = false;
	for (const k of [
		"text",
		"image_input",
		"audio_input",
		"video_input",
		"image_output",
		"audio_output",
		"tool_use",
		"stream",
	] as const) {
		const v = obj[k];
		if (typeof v === "boolean") {
			cap[k] = v;
			any = true;
		}
	}
	return any ? cap : undefined;
}

function numberOrUndefined(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function boolOrUndefined(v: unknown): boolean | undefined {
	return typeof v === "boolean" ? v : undefined;
}

function validateModelAliases(
	rawAliases: Record<string, unknown>,
	providerNames: Set<string>,
): Record<string, string> {
	const aliases = createConfigMap<string>();
	for (const [alias, target] of Object.entries(rawAliases)) {
		if (alias !== "*" && alias.includes("/")) {
			throw new Error(
				`models.aliases.${alias}: alias key must not contain "/"`,
			);
		}
		if (typeof target !== "string") {
			throw new Error(`models.aliases.${alias} must be a string`);
		}
		const slashIndex = target.indexOf("/");
		if (slashIndex <= 0 || slashIndex === target.length - 1) {
			throw new Error(
				`models.aliases.${alias}: value must be "provider/model" format, got "${target}"`,
			);
		}
		const provider = target.slice(0, slashIndex);
		if (!providerNames.has(provider)) {
			throw new Error(
				`models.aliases.${alias}: provider "${provider}" is not configured`,
			);
		}
		aliases[alias] = target;
	}
	return aliases;
}
