import type {
	ChatCompletionCreateRequest,
	ChatCompletionMessageParam,
} from "../protocol/openai/completions";

export interface GodexPluginContext {
	readonly model: string;
	readonly provider: string;
	readonly alias?: string;
}

export interface GodexPluginHooks {
	transformChatMessages?: (
		messages: readonly ChatCompletionMessageParam[],
		ctx: GodexPluginContext,
	) => ChatCompletionMessageParam[] | Promise<ChatCompletionMessageParam[]>;
	patchRequest?: (
		request: ChatCompletionCreateRequest,
		ctx: GodexPluginContext,
	) => ChatCompletionCreateRequest | Promise<ChatCompletionCreateRequest>;
	transformStreamDelta?: (
		delta: unknown,
		ctx: GodexPluginContext,
	) => unknown | Promise<unknown>;
}

export interface GodexPlugin {
	readonly name: string;
	readonly hooks: GodexPluginHooks;
}

export async function loadPlugins(
	paths: readonly string[],
): Promise<readonly GodexPlugin[]> {
	const plugins: GodexPlugin[] = [];
	for (const path of paths) {
		const mod = (await import(/* @vite-ignore */ path)) as Record<
			string,
			unknown
		>;
		const candidate = (mod.default ?? mod.plugin ?? mod) as
			| Partial<GodexPlugin>
			| undefined;
		if (
			!candidate ||
			typeof candidate !== "object" ||
			typeof candidate.name !== "string" ||
			typeof candidate.hooks !== "object" ||
			candidate.hooks === null
		) {
			throw new Error(
				`Plugin ${path} did not export a GodexPlugin (expected { name, hooks }).`,
			);
		}
		plugins.push(candidate as GodexPlugin);
	}
	return plugins;
}

export async function applyPluginChatMessagesHooks(
	plugins: readonly GodexPlugin[],
	messages: readonly ChatCompletionMessageParam[],
	ctx: GodexPluginContext,
): Promise<ChatCompletionMessageParam[]> {
	let current: ChatCompletionMessageParam[] = messages.map((m) => ({ ...m }));
	for (const plugin of plugins) {
		const hook = plugin.hooks.transformChatMessages;
		if (!hook) continue;
		current = await hook(current, ctx);
	}
	return current;
}

export async function applyPluginPatchRequestHooks(
	plugins: readonly GodexPlugin[],
	request: ChatCompletionCreateRequest,
	ctx: GodexPluginContext,
): Promise<ChatCompletionCreateRequest> {
	let current: ChatCompletionCreateRequest = request;
	for (const plugin of plugins) {
		const hook = plugin.hooks.patchRequest;
		if (!hook) continue;
		current = await hook(current, ctx);
	}
	return current;
}

export async function applyPluginStreamDeltaHooks(
	plugins: readonly GodexPlugin[],
	delta: unknown,
	ctx: GodexPluginContext,
): Promise<unknown> {
	let current: unknown = delta;
	for (const plugin of plugins) {
		const hook = plugin.hooks.transformStreamDelta;
		if (!hook) continue;
		current = await hook(current, ctx);
	}
	return current;
}
