import { asConfigObject } from "../raw";

export interface PluginsConfig {
	paths: string[];
}

export function parsePluginsConfig(raw: unknown): PluginsConfig {
	const root = asConfigObject(raw);
	const candidates = Array.isArray(root.paths) ? root.paths : [];
	const paths: string[] = [];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			throw new Error("plugins.paths entries must be strings");
		}
		const trimmed = candidate.trim();
		if (trimmed) paths.push(trimmed);
	}
	return { paths };
}
