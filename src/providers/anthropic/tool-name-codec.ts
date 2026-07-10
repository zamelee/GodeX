// src/providers/anthropic/tool-name-codec.ts
//
// Sanitize Codex Responses API tool names to satisfy Anthropic's regex
// `^[a-zA-Z0-9_-]{1,64}$`. Codex may emit arbitrary names (dots, slashes,
// `@`, namespace separators like `mcp__server__tool`, etc.) that Anthropic
// rejects on the wire.
//
// The codec is stateful: each instance maintains a bidirectional Map so that
// tool_use blocks returned by the upstream can be decoded back to the
// original Codex name (the Anthropic-side name is what we send in the
// request, and what arrives back in tool_use.id + content_block.name).
//
// Why not the default identity codec (see `src/bridge/tools/tool-identity.ts`)?
// The default is stateless and uses `fromProviderName = identity`, which means
// Codex sees a sanitized name on the round-trip and may try to call a tool by
// its original name (mismatch). Anthropic needs a reversible mapping for the
// `mcp__server__tool`-style names that Codex produces.
//
// Collision policy: if two distinct Codex names sanitize to the same
// provider name, the second one gets a `_2`, `_3`, ... suffix appended.

import type { ToolNameCodec } from "../../bridge/provider-spec";

export const ANTHROPIC_TOOL_NAME_MAX_LENGTH = 64;
const ANTHROPIC_TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const COLLISION_SUFFIX_RESERVED = 8;
const MAX_COLLISION_ATTEMPTS = 10_000;

function sanitizeBase(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

function isValidAnthropicName(name: string): boolean {
	return ANTHROPIC_TOOL_NAME_REGEX.test(name);
}

export class AnthropicToolNameCodec implements ToolNameCodec {
	private readonly toProvider = new Map<string, string>();
	private readonly toCodex = new Map<string, string>();
	private readonly usedProviderNames = new Set<string>();

	toProviderName(codexName: string): string {
		const cached = this.toProvider.get(codexName);
		if (cached !== undefined) return cached;

		const sanitized = sanitizeBase(codexName) || "tool";

		let candidate: string;
		if (sanitized.length <= ANTHROPIC_TOOL_NAME_MAX_LENGTH) {
			candidate = sanitized;
		} else {
			candidate = sanitized.slice(
				0,
				ANTHROPIC_TOOL_NAME_MAX_LENGTH - COLLISION_SUFFIX_RESERVED,
			);
		}

		let final = candidate;
		let counter = 2;
		while (this.usedProviderNames.has(final)) {
			const suffix = `_${counter}`;
			const room = ANTHROPIC_TOOL_NAME_MAX_LENGTH - suffix.length;
			final = `${candidate.slice(0, room)}${suffix}`;
			counter++;
			if (counter > MAX_COLLISION_ATTEMPTS) {
				throw new Error(
					`AnthropicToolNameCodec: too many collisions sanitizing "${codexName}"`,
				);
			}
		}

		if (!isValidAnthropicName(final)) {
			// Sanitize once more defensively; should be impossible given the
			// sanitizeBase call above, but we keep the guard so the contract
			// holds if the rules above ever change.
			final = sanitizeBase(final) || "tool";
		}

		this.toProvider.set(codexName, final);
		this.toCodex.set(final, codexName);
		this.usedProviderNames.add(final);
		return final;
	}

	fromProviderName(providerName: string): string | undefined {
		return this.toCodex.get(providerName);
	}

	// --- Inspection helpers (not part of the ToolNameCodec contract) ---

	size(): { readonly providers: number; readonly codex: number } {
		return {
			providers: this.toProvider.size,
			codex: this.toCodex.size,
		};
	}
}
