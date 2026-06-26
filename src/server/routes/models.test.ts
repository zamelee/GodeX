import { describe, expect, test } from "bun:test";
import type { GodeXConfig } from "../../config";
import { ApplicationContext } from "../../context/application-context";
import { Registrar } from "../../providers/registrar";
import { createTestProviderEdge } from "../../testing/provider-edge";
import { handleModels } from "./models";

const config: GodeXConfig = {
	server: { port: 0, host: "127.0.0.1" },
	default_provider: "zhipu",
	models: {
		aliases: {
			"*": "zhipu/glm-4",
			"gpt-5": "zhipu/glm-5.1",
		},
	},
	providers: {
		zhipu: {
			spec: "zhipu",
			credentials: { api_key: "test-key" },
			endpoint: { base_url: "http://127.0.0.1:1" },
		},
		unsupported: {
			spec: "unsupported",
			credentials: { api_key: "test-key" },
			endpoint: { base_url: "http://127.0.0.1:2" },
		},
	},
	session: { backend: "memory" },
	logging: { level: "error" },
	trace: {
		enabled: false,
		path: "./data/trace.db",
		max_queue_size: 10000,
		flush_interval_ms: 1000,
		batch_size: 100,
		capture_payload: false,
		payload_max_bytes: 65536,
	},
};

function createTestApp(): ApplicationContext {
	const registrar = new Registrar();
	registrar.registerFactory("zhipu", () =>
		createTestProviderEdge({ name: "zhipu" }),
	);
	return new ApplicationContext(config, registrar);
}

describe("GET /v1/models", () => {
	test("lists models from root aliases", async () => {
		const app = createTestApp();
		const res = handleModels(app);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			models: {
				slug: string;
				id: string;
				name: string;
				description?: string;
				input_modalities?: string[];
				supports_image_detail_original?: boolean;
				context_window?: number;
				display_name?: string;
				visibility?: string;
			}[];
		};

		expect(body.models).toHaveLength(1);
		const model = body.models[0]!; // biome: pre-checked
		expect(model.slug).toBe("gpt-5");
		expect(model.id).toBe("gpt-5");
		expect(model.name).toBe("gpt-5");
		expect(model.display_name).toBe("gpt-5");
		expect(model.visibility).toBe("list");
		// gpt-5 preset has multimodal {image_input: true, audio_input: true}
		expect(model.input_modalities).toEqual(["text", "image", "audio"]);
		expect(model.supports_image_detail_original).toBe(true);
		// gpt-5 preset has notes about max_output_tokens vs max_completion_tokens
		expect(model.description).toContain("max_output_tokens");
		expect(body.models.some((m) => m.slug === "*")).toBe(false);
	});

	test("omits aliases pointing to unregistered providers", async () => {
		const cfg: GodeXConfig = {
			...config,
			models: {
				aliases: {
					"gpt-5": "zhipu/glm-5.1",
					ghost: "unsupported/ghost-model",
					"gpt-4o": "zhipu/glm-4.7",
				},
			},
		};
		const registrar = new Registrar();
		registrar.registerFactory("zhipu", () =>
			createTestProviderEdge({ name: "zhipu" }),
		);
		const app = new ApplicationContext(cfg, registrar);
		const res = handleModels(app);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			models: {
				slug: string;
				id: string;
				input_modalities?: string[];
				supports_image_detail_original?: boolean;
				description?: string;
			}[];
		};

		expect(body.models.some((m) => m.slug === "ghost")).toBe(false);
		expect(body.models.some((m) => m.slug === "gpt-5")).toBe(true);
		expect(body.models.some((m) => m.slug === "gpt-4o")).toBe(true);

		// gpt-5 has image+audio, so modalities should include both
		const gpt5 = body.models.find((m) => m.slug === "gpt-5")!; // biome: pre-checked
		expect(gpt5.input_modalities).toEqual(["text", "image", "audio"]);
		expect(gpt5.supports_image_detail_original).toBe(true);
	});

	test("defaults unknown models to text-only modalities and no description", async () => {
		const cfg: GodeXConfig = {
			...config,
			models: {
				aliases: {
					"custom-unknown-model": "zhipu/some-model",
				},
			},
		};
		const registrar = new Registrar();
		registrar.registerFactory("zhipu", () =>
			createTestProviderEdge({ name: "zhipu" }),
		);
		const app = new ApplicationContext(cfg, registrar);
		const res = handleModels(app);
		const body = (await res.json()) as {
			models: {
				slug: string;
				input_modalities?: string[];
				supports_image_detail_original?: boolean;
				description?: string;
			}[];
		};

		const model = body.models.find((m) => m.slug === "custom-unknown-model")!; // biome: pre-checked
		expect(model.input_modalities).toEqual(["text"]);
		expect(model.supports_image_detail_original).toBe(false);
		expect(model.description).toBeUndefined();
	});

	test("derives correct modalities for known non-multimodal models", async () => {
		const cfg: GodeXConfig = {
			...config,
			models: {
				aliases: {
					"deepseek-v3": "zhipu/deepseek-chat",
				},
			},
		};
		const registrar = new Registrar();
		registrar.registerFactory("zhipu", () =>
			createTestProviderEdge({ name: "zhipu" }),
		);
		const app = new ApplicationContext(cfg, registrar);
		const res = handleModels(app);
		const body = (await res.json()) as {
			models: {
				slug: string;
				input_modalities?: string[];
				supports_image_detail_original?: boolean;
			}[];
		};

		// deepseek-v3 preset has multimodal: {} (empty) - text only
		const ds = body.models.find((m) => m.slug === "deepseek-v3")!; // biome: pre-checked
		expect(ds.input_modalities).toEqual(["text"]);
		expect(ds.supports_image_detail_original).toBe(false);
	});
});
