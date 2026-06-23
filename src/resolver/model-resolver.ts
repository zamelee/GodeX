import {
	SERVER_MODEL_NOT_FOUND,
	ServerError,
} from "../error";
import type { EnabledModel } from "../config/schema";
import type { ResolvedModel } from "./model-reference";
import { ModelAliasCatalog, type ModelAliasEntry } from "./model-aliases";
import { parseModelSelector } from "./model-selector";

export interface ModelResolverOptions {
	defaultProvider: string;
	aliases?: Record<string, string>;
	enabled?: readonly EnabledModel[];
}

export class ModelResolver {
	private readonly defaultProvider: string;
	private readonly enabled: readonly EnabledModel[];
	private readonly aliases: ModelAliasCatalog;

	constructor(options: ModelResolverOptions) {
		this.defaultProvider = options.defaultProvider;
		this.enabled = options.enabled ?? [];
		this.aliases = new ModelAliasCatalog(options.aliases);
	}

	resolve(model: unknown): ResolvedModel {
		const selector = parseModelSelector(model);

		if (selector.kind === "provider_model") {
			if (this.enabled.length > 0) {
				const matched = findEnabledMatch(this.enabled, selector.resolved.model);
				if (!matched || matched.provider !== selector.resolved.provider) {
					throw new ServerError(
						SERVER_MODEL_NOT_FOUND,
						`Model not found: ${selector.resolved.provider}/${selector.resolved.model}`,
						{
							model: selector.selector,
							reason: "selector did not match any registered alias or enabled model",
							hint: "check GET /v1/models for the list of supported aliases",
						},
					);
				}
			}
			return selector.resolved;
		}

		const bareModel = selector.model;
		const aliased = this.aliases.resolveBareModel(bareModel);
		if (aliased) return aliased;

		// When the operator has configured an explicit enabled list, bare
		// selectors must match either an alias, a "<provider>/<model>" entry,
		// or a bare model name within the enabled list. Unmatched bare
		// selectors are rejected so requests are not silently rewritten to
		// the default provider and forwarded to upstream providers that do
		// not support the requested model.
		if (this.enabled.length > 0) {
			const matched = findEnabledMatch(this.enabled, bareModel);
			if (matched) {
				return { provider: matched.provider, model: matched.model };
			}
			throw new ServerError(
				SERVER_MODEL_NOT_FOUND,
				`Model not found: ${bareModel}`,
				{
					model: bareModel,
					reason: "selector did not match any registered alias or enabled model",
					hint: "check GET /v1/models for the list of supported aliases",
				},
			);
		}

		// Backward compatibility: when no enabled list is configured, fall
		// back to the default provider. This preserves the legacy behavior
		// of godex installations that only rely on aliases.
		return {
			provider: this.defaultProvider,
			model: bareModel,
		};
	}

	listAliases(registeredProviders?: Iterable<string>): ModelAliasEntry[] {
		return this.aliases.list(registeredProviders);
	}
}

function findEnabledMatch(
	enabled: readonly EnabledModel[],
	model: string,
): EnabledModel | undefined {
	const target = model.toLowerCase();
	return enabled.find(
		(entry) =>
			entry.model.toLowerCase() === target ||
			`${entry.provider.toLowerCase()}/${entry.model.toLowerCase()}` === target,
	);
}