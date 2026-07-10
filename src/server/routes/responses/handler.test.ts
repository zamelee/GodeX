import { describe, expect, test } from "bun:test";
import { ProviderError } from "../../../error";
import type { Logger } from "../../../logger";
import { handleResponses } from "./index";
import {
	type CapturedLog,
	createCapturingLogger,
	createTestApp,
	jsonRequest,
} from "./test-fixtures";

describe("handleResponses", () => {
	test("maps sync requests exactly once through the responses bridge", async () => {
		let requestCalls = 0;
		const app = createTestApp({
			onRequest() {
				requestCalls++;
			},
		});

		const res = await handleResponses(jsonRequest(basicBody()), app);

		expect(res.status).toBe(200);
		expect(requestCalls).toBe(1);
	});

	test("rejects invalid model selectors as request errors", async () => {
		const app = createTestApp();

		for (const model of [" ", "/glm-5.1", "zhipu/", 42]) {
			const res = await handleResponses(
				jsonRequest({
					model,
					input: "hi",
				}),
				app,
			);

			expect(res.status).toBe(400);
			const body = (await res.json()) as {
				error: { code: string; message: string };
			};
			expect([
				"server.request.missing_model",
				"server.request.invalid_parameter",
			]).toContain(body.error.code);
			expect(body.error.message).toContain("model");
		}
	});

	test("does not include request id header for model context failures", async () => {
		const app = createTestApp();

		const res = await handleResponses(
			jsonRequest({
				model: "zhipu/",
				input: "hi",
			}),
			app,
		);

		expect(res.status).toBe(400);
		expect(res.headers.get("x-request-id")).toBeNull();
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("server.request.invalid_parameter");
	});

	test("does not include request id header for session-chain context failures", async () => {
		const app = createTestApp();

		const res = await handleResponses(
			jsonRequest({
				...basicBody(),
				previous_response_id: "resp_missing",
			}),
			app,
		);

		expect(res.status).toBe(400);
		expect(res.headers.get("x-request-id")).toBeNull();
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("session.chain.not_found");
	});

	test("returns provider errors as HTTP status before SSE starts", async () => {
		// Path D plan D: stream() is now wrap-mode, which routes through
		// sync request() under the hood. Pre-SSE errors therefore come from
		// the sync path. The HTTP-status mapping still applies.
		const logs: CapturedLog[] = [];
		const app = createTestApp({
			streamMode: "wrap",
			async request() {
				throw new ProviderError(
					"provider.upstream.rate_limit",
					"Too many requests",
					{
						provider: "zhipu",
						model: "glm-4",
						upstreamStatus: 429,
						upstreamBody: "rate limited",
					},
				);
			},
		});
		Object.defineProperty(app, "logger", {
			value: createCapturingLogger(logs),
		});

		const res = await handleResponses(
			jsonRequest({
				...basicBody(),
				stream: true,
			}),
			app,
		);

		expect(res.status).toBe(429);
		expect(res.headers.get("x-request-id")).toMatch(/^req_/);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("rate_limit_exceeded");
	});

	test("maps sync provider errors with request id header", async () => {
		const logs: CapturedLog[] = [];
		const app = createTestApp({
			async request() {
				throw new ProviderError(
					"provider.upstream.timeout",
					"Request timed out",
					{
						provider: "zhipu",
						model: "glm-4",
						upstreamStatus: 408,
					},
				);
			},
		});
		Object.defineProperty(app, "logger", {
			value: createCapturingLogger(logs),
		});

		const res = await handleResponses(jsonRequest(basicBody()), app);

		expect(res.status).toBe(408);
		expect(res.headers.get("x-request-id")).toMatch(/^req_/);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("request_timeout");
	});

	test("returns response.failed SSE on stream setup errors", async () => {
		// Path D plan D: stream() is wrap-mode, so the sync pipeline
		// runs first. The wrap function detects response.status === "failed"
		// and emits a response.failed SSE event carrying the error in the
		// response payload. We override app.responses to return a failed
		// ResponseObject directly (the provider-level mock cannot produce
		// one in the new wrap mode).
		// Path D plan D: the runtime is wrap-mode, so both `request` and
		// `stream` end up calling the same sync pipeline under the hood.
		// Mocking the entire bridge with a single object that returns the
		// failed ResponseObject from both methods keeps the test honest.
		const app = createTestApp();
		const failedResponse: import("../../../protocol/openai/responses").ResponseObject =
			{
				id: "resp_123",
				object: "response",
				created_at: 0,
				status: "failed",
				model: "test",
				output: [],
				output_text: "",
				usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
				error: {
					code: "rate_limit_exceeded",
					message: "Too many requests",
				},
				incomplete_details: null,
			};
		// In wrap mode the runtime calls syncPipeline.request() and wraps the
		// resulting ResponseObject as SSE. Reproduce that here so we test the
		// handler’s SSE serialization for a failed response without going
		// through the real provider exchange.
		(app.responses as unknown as {
			request: typeof app.responses.request;
			stream: typeof app.responses.stream;
		}) = {
			request: async () => failedResponse,
			stream: async () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue({
							type: "response.created",
							sequence_number: 0,
							response: { ...failedResponse, output: [] },
						});
						controller.enqueue({
							type: "response.in_progress",
							sequence_number: 1,
							response: { ...failedResponse, output: [] },
						});
						controller.enqueue({
							type: "response.failed",
							sequence_number: 2,
							response: failedResponse,
						});
						controller.close();
					},
				}),
		};

		const res = await handleResponses(
			jsonRequest({
				...basicBody(),
				stream: true,
			}),
			app,
		);

		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("event: response.created");
		expect(body).toContain("event: response.in_progress");
		expect(body).toContain("event: response.failed");
		// Path D plan D: errors are serialized via the response.error
		// field rather than embedded in the SSE event string.
		expect(body).toContain("rate_limit_exceeded");
		expect(body).toContain("Too many requests");
	});

	test("does not log errors after the SSE stream has completed", async () => {
		const loggedErrors: string[] = [];
		const logger: Logger = {
			level: "error",
			child: () => logger,
			trace: () => {},
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: (event) => {
				loggedErrors.push(event);
			},
		};
		const app = createTestApp({
			streamEvents: [{ event: "message", data: { finishReason: "stop" } }],
		});
		Object.defineProperty(app, "logger", { value: logger });

		const res = await handleResponses(
			jsonRequest({
				...basicBody(),
				stream: true,
			}),
			app,
		);

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("response.created");
		expect(loggedErrors).toEqual([]);
	});

	test("resolves the requested model once for a request", async () => {
		const app = createTestApp();
		const originalResolver = app.resolver;
		let resolveCalls = 0;
		Object.defineProperty(app, "resolver", {
			value: {
				resolve(model: string) {
					resolveCalls++;
					return originalResolver.resolve(model);
				},
			},
		});

		const res = await handleResponses(jsonRequest(basicBody()), app);

		expect(res.status).toBe(200);
		expect(resolveCalls).toBe(1);
	});

	test("logs unexpected errors with dot-only event name and request_id", async () => {
		const logs: CapturedLog[] = [];
		const app = createTestApp({
			async request() {
				throw new Error("boom");
			},
		});
		Object.defineProperty(app, "logger", {
			value: createCapturingLogger(logs),
		});

		const res = await handleResponses(jsonRequest(basicBody()), app);

		expect(res.status).toBe(500);
		const errorLog = logs.find((log) => log.event === "godex.unexpected.error");
		expect(errorLog?.attr?.request_id).toMatch(/^req_/);
		expect(errorLog?.attr).not.toHaveProperty("requestId");
	});

	test("records provider errors into trace when context exists", async () => {
		const traceEvents: unknown[] = [];
		const app = createTestApp({
			async request() {
				throw new ProviderError("provider.upstream.error", "Upstream failed", {
					provider: "zhipu",
					model: "glm-5.1",
					upstreamStatus: 400,
					upstreamBody: { error: { message: "bad request" } },
				});
			},
		});
		Object.defineProperty(app, "traceEnabled", { value: true });
		Object.defineProperty(app, "traceRecorder", {
			value: { record: (event: unknown) => traceEvents.push(event) },
		});

		const res = await handleResponses(jsonRequest(basicBody()), app);

		expect(res.status).toBe(422);
		expect(traceEvents).toContainEqual(
			expect.objectContaining({
				kind: "error",
				event_name: "responses.request.provider.error",
				provider: "zhipu",
				model: "glm-5.1",
				domain: "provider",
				code: "provider.upstream.error",
				message: "Upstream failed",
				status: 502,
				payload: {
					payload: expect.objectContaining({
						upstreamStatus: 400,
						upstreamBody: { error: { message: "bad request" } },
					}),
				},
			}),
		);
	});

	test("maps bridge translation failures to invalid request errors", async () => {
		const app = createTestApp();

		const res = await handleResponses(
			jsonRequest({
				...basicBody(),
				input: [
					{
						role: "user",
						content: [
							{ type: "input_image", image_url: "https://example.com" },
						],
					},
				],
			}),
			app,
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("bridge.request.unsupported_input_content");
	});
});

function basicBody(): Record<string, unknown> {
	return {
		model: "zhipu/glm-5.1",
		input: "hi",
	};
}
