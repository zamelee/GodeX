import { describe, test } from "bun:test";

const apiKey = process.env.MINIMAX_API_KEY;
const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://minnimax.chat/v1";
const liveDescribe = apiKey ? describe : describe.skip;

liveDescribe("直接测试上游 API", () => {
	test("MiniMax-M3 是否调用 tool_search（直接 API）", async () => {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: "MiniMax-M3",
				messages: [
					{
						role: "user",
						content:
							"你有哪些工具可用？请调用 tool_search 工具来搜索可用的工具。",
					},
				],
				tools: [
					{
						type: "function",
						function: {
							name: "tool_search",
							description:
								"搜索可用的 MCP 工具。通过这个工具可以发现可用的内置工具。",
							parameters: {
								type: "object",
								properties: {
									query: {
										type: "string",
										description: "搜索查询",
									},
								},
								required: ["query"],
							},
						},
					},
				],
				max_tokens: 1024,
			}),
		});

		const body = (await response.json()) as {
			choices?: Array<{
				message?: {
					tool_calls?: Array<{
						function: { name: string; arguments: string };
					}>;
				};
			}>;
			error?: { message: string };
		};

		console.log("=== 直接 API 响应 ===");
		console.log("status:", response.status);

		if (body.error) {
			console.log("❌ API 错误:", body.error.message);
			return;
		}

		console.log("choices:", JSON.stringify(body.choices, null, 2));

		const toolCalls = body.choices?.[0]?.message?.tool_calls ?? [];
		const toolSearchCalls = toolCalls.filter(
			(tc) => tc.function.name === "tool_search",
		);

		if (toolSearchCalls.length > 0) {
			console.log("✅ 模型调用了 tool_search!");
			console.log("调用:", JSON.stringify(toolSearchCalls, null, 2));
		} else {
			console.log("❌ 模型没有调用 tool_search");
			console.log("所有 tool_calls:", JSON.stringify(toolCalls, null, 2));
		}
	}, 120_000);

	test("MiniMax-M2.7-highspeed 是否调用 tool_search", async () => {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: "MiniMax-M2.7-highspeed",
				messages: [
					{
						role: "user",
						content: "你有哪些工具可用？请调用 tool_search 工具。",
					},
				],
				tools: [
					{
						type: "function",
						function: {
							name: "tool_search",
							description: "搜索可用的工具",
							parameters: {
								type: "object",
								properties: {
									query: { type: "string" },
								},
							},
						},
					},
				],
				max_tokens: 512,
			}),
		});

		const body = (await response.json()) as {
			choices?: Array<{
				message?: {
					tool_calls?: Array<{
						function: { name: string; arguments: string };
					}>;
				};
			}>;
			error?: { message: string };
		};

		console.log("=== MiniMax-M2.7-highspeed ===");
		console.log("status:", response.status);

		if (body.error) {
			console.log("❌ API 错误:", body.error.message);
			return;
		}

		const toolCalls = body.choices?.[0]?.message?.tool_calls ?? [];
		const toolSearchCalls = toolCalls.filter(
			(tc) => tc.function.name === "tool_search",
		);

		console.log(toolSearchCalls.length > 0 ? "✅ 调用了" : "❌ 未调用");
		console.log("tool_calls:", JSON.stringify(toolCalls, null, 2));
	}, 120_000);
});
