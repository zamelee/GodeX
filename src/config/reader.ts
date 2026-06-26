import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

export function loadConfigFromFile(
	configPath: string,
): Record<string, unknown> | null {
	const absolute = resolve(configPath);
	if (!existsSync(absolute)) return null;

	let raw: string;
	try {
		if (!statSync(absolute).isFile()) {
			throw new Error("path is not a file");
		}
		raw = readFileSync(absolute, "utf-8");
	} catch (error) {
		throw new Error(`Failed to read config file: ${configPath}`, {
			cause: error,
		});
	}

	let parsed: unknown;
	try {
		parsed = yaml.load(raw);
	} catch (error) {
		const detail = (error as { reason?: string; mark?: { line?: number; column?: number } }).reason ?? (error as Error).message;
		const mark = (error as { mark?: { line?: number; column?: number } }).mark;
		const where = mark?.line !== undefined ? ` (line ${mark.line + 1}, column ${(mark.column ?? 0) + 1})` : "";
		throw new Error(`Failed to parse config file: ${configPath}${where}: ${detail}`, {
			cause: error,
		});
	}

	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: {};
}
