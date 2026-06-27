import { afterAll, beforeAll, describe, test } from "bun:test";
import type { GodeXConfig } from "../config";
import { ApplicationContext } from "../context/application-context";
import type { ResponseCreateRequest } from "../protocol/openai/responses";
import {
	createMiniMaxProvider,
	DEFAULT_MINIMAX_BASE_URL,
} from "../providers/minimax";
import { Registrar } from "../providers/registrar";
import { createBuiltinRoutes, startServer } from "../server";
import { type GodeXClient, godexClient } from "./godex-client";
import { getLoopbackPort } from "./ports";

const apiKey = process.env.MINIMAX_API_KEY;
const liveEnabled = process.env.MINIMAX_LIVE_TESTS === "1";
const liveDescribe = apiKey && liveEnabled ? describe : describe.skip;
const minimaxBaseUrl = process.env.MINIMAX_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL;
const liveModel = process.env.MINIMAX_LIVE_MODEL ?? "MiniMax-M3";

let godexServer: ReturnType<typeof Bun.serve> | null = null;
let client: GodeXClient;

function createLiveConfig(port: number): GodeXConfig {
	return {
		server: { port, host: "127.0.0.1" },
		default_provider: "minimax",
		models: {
			aliases: {
				"gpt-5": `minimax/${liveModel}`,
			},
		},
		providers: {
			minimax: {
				spec: "minimax",
				credentials: { api_key: apiKey ?? "" },
				endpoint: { base_url: minimaxBaseUrl },
			},
		},
		session: { backend: "memory" },
		logging: { level: "debug" },
		trace: { enabled: false, path: "./data/trace.db" },
	};
}

beforeAll(async () => {
	if (!apiKey || !liveEnabled) return;
	const config = createLiveConfig(await getLoopbackPort());
	const reg = new Registrar();
	reg.registerFactory("minimax", () =>
		createMiniMaxProvider({
			spec: "minimax",
			credentials: { api_key: apiKey },
			endpoint: { base_url: minimaxBaseUrl },
			timeout_ms: 120_000,
		}),
	);
	const app = new ApplicationContext(config, reg);
	godexServer = startServer({
		config,
		configPath: "tool-search-test",
		logger: app.logger,
		routes: createBuiltinRoutes(app),
	});
	client = godexClient({
		baseURL: `http://127.0.0.1:${godexServer.port}`,
		apiKey: "test-key",
	});
});

afterAll(() => {
	godexServer?.stop();
});

/**
 * 测试各个模型是否会调用 tool_search
 *
 * 运行方式:
 *   $env:MINIMAX_API_KEY="xxx"; $env:MINIMAX_LIVE_TESTS="1"; bun test src/e2e/tool-search-discovery.test.ts
 */
liveDescribe("Tool Search Discovery 测试", () => {
	test("MiniMax-M3 是否调用 tool_search", async () => {
		const request: ResponseCreateRequest = {
			model: "gpt-5",
			input: [
				{
					role: "user",
					content: [
						{
							type: "input_text",
							text: "你有哪些工具可以用？请调用 tool_search 工具来搜索可用的工具。",
						},
					],
				},
			],
			tools: [
				{
					type: "tool_search",
					description:
						"搜索可用的 MCP 工具。通过这个工具可以发现可用的内置工具。",
				},
			],
			max_output_tokens: 1024,
			temperature: 0.7,
		};

		const res = await client.responses.createRaw(request);
		const body = (await res.json()) as {
			status: string;
			output?: Array<{ type: string; name?: string; call_id?: string }>;
		};

		console.log("=== MiniMax-M3 响应 ===");
		console.log("status:", body.status);
		console.log("output:", JSON.stringify(body.output, null, 2));

		const toolSearchCalls = body.output?.filter(
			(item) => item.type === "tool_search_call" || item.name === "tool_search",
		);

		if (toolSearchCalls && toolSearchCalls.length > 0) {
			console.log("✅ 模型调用了 tool_search!");
			console.log("调用详情:", JSON.stringify(toolSearchCalls, null, 2));
		} else {
			console.log("❌ 模型没有调用 tool_search");
		}

		const functionCalls = body.output?.filter(
			(item) => item.type === "function_call",
		);
		if (functionCalls && functionCalls.length > 0) {
			console.log(
				"📋 检测到 function_call:",
				JSON.stringify(functionCalls, null, 2),
			);
		}
	}, 120_000);
});
