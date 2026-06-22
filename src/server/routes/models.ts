import type { ApplicationContext } from "../../context/application-context";
import { loadModelPresets, getModelMetadata } from "../../config/model-presets";

interface ModelListItem {
	id: string;
	object: "model";
	owned_by: string;
	context_window?: number;
	max_tokens?: number;
}

export function handleModels(app: ApplicationContext): Response {
	const presets = loadModelPresets(app.configPath);

	const data: ModelListItem[] = app.resolver
		.listAliases(app.registrar.list())
		.map((entry) => {
			const metadata = getModelMetadata(entry.alias, presets);
			return {
				id: entry.alias,
				object: "model",
				owned_by: entry.target.provider,
				...metadata,
			};
		});

	return Response.json({ object: "list", data });
}
