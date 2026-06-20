import type { ApplicationContext } from "../../context/application-context";
import type { EnabledModel } from "../../config/schema";

export interface EnabledModelItem {
	provider: string;
	model: string;
	context_window?: number;
	max_tokens?: number;
	multimodal?: boolean;
	capabilities?: Record<string, boolean>;
	note?: string;
}

export function handleEnabledModels(app: ApplicationContext): Response {
	const enabled = app.config.models?.enabled ?? [];
	const data: EnabledModelItem[] = enabled.map(stripUndef);
	return Response.json({ object: "list", data });
}

function stripUndef(item: EnabledModel): EnabledModelItem {
	const out: EnabledModelItem = { provider: item.provider, model: item.model };
	if (item.context_window !== undefined) out.context_window = item.context_window;
	if (item.max_tokens !== undefined) out.max_tokens = item.max_tokens;
	if (item.multimodal !== undefined) out.multimodal = item.multimodal;
	if (item.capabilities !== undefined) out.capabilities = item.capabilities as Record<string, boolean>;
	if (item.note !== undefined) out.note = item.note;
	return out;
}
