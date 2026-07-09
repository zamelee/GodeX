import { describe, expect, test } from "bun:test";
import type {
	FunctionCall,
	FunctionCallOutput,
	Reasoning,
	ResponseObject,
	ResponseOutputMessage,
} from "../protocol/openai/responses";
import { wrapResponseObjectAsSseStream } from "./response-object-stream";

async function collect(
	stream: ReadableStream<{ type: string; sequence_number?: number }>,
): Promise<{ type: string; sequence_number: number }[]> {
	const out: { type: string; sequence_number: number }[] = [];
	const reader = stream.getReader();
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		out.push({ type: value.type, sequence_number: value.sequence_number ?? 0 });
	}
	return out;
}

function makeResponse(
	output: ResponseObject["output"],
	overrides: Partial<ResponseObject> = {},
): ResponseObject {
	return {
		id: "resp_test",
		object: "response",
		created_at: 0,
		status: "completed",
		model: "test-model",
		output,
		output_text: "",
		usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
		error: null,
		incomplete_details: null,
		...overrides,
	};
}

describe("wrapResponseObjectAsSseStream", () => {
	test("emits response.created, in_progress, and completed even with empty output", async () => {
		const stream = wrapResponseObjectAsSseStream(makeResponse([]));
		const events = await collect(stream);
		expect(events.map((e) => e.type)).toEqual([
			"response.created",
			"response.in_progress",
			"response.completed",
		]);
	});

	test("sequence numbers are monotonic starting at 0", async () => {
		const stream = wrapResponseObjectAsSseStream(makeResponse([]));
		const events = await collect(stream);
		expect(events.map((e) => e.sequence_number)).toEqual([0, 1, 2]);
	});

	test("reasoning item emits reasoning_text part events", async () => {
		const reasoning: Reasoning = {
			id: "rs_1",
			type: "reasoning",
			summary: [],
			content: [{ type: "reasoning_text", text: "thinking..." }],
			status: "completed",
		};
		const stream = wrapResponseObjectAsSseStream(makeResponse([reasoning]));
		const types = (await collect(stream)).map((e) => e.type);
		expect(types).toContain("response.output_item.added");
		expect(types).toContain("response.reasoning_text_part.added");
		expect(types).toContain("response.reasoning_text.delta");
		expect(types).toContain("response.reasoning_text.done");
		expect(types).toContain("response.reasoning_text_part.done");
		expect(types).toContain("response.output_item.done");
	});

	test("function_call item emits arguments events", async () => {
		const fnCall: FunctionCall = {
			id: "fc_1",
			type: "function_call",
			call_id: "call_1",
			name: "godex_chrome_list_pages",
			arguments: "{}",
			status: "completed",
		};
		const stream = wrapResponseObjectAsSseStream(makeResponse([fnCall]));
		const types = (await collect(stream)).map((e) => e.type);
		expect(types).toContain("response.function_call_arguments.delta");
		expect(types).toContain("response.function_call_arguments.done");
	});

	test("function_call_output item emits added/done without content deltas", async () => {
		const fnOut: FunctionCallOutput = {
			id: "fco_1",
			type: "function_call_output",
			call_id: "call_1",
			output: '[{"title":"Example Domain"}]',
			status: "completed",
		};
		const stream = wrapResponseObjectAsSseStream(makeResponse([fnOut]));
		const types = (await collect(stream)).map((e) => e.type);
		expect(types).toContain("response.output_item.added");
		expect(types).toContain("response.output_item.done");
		expect(types).not.toContain("response.function_call_arguments.delta");
	});

	test("message item emits content_part and output_text events", async () => {
		const message: ResponseOutputMessage = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "hello world", annotations: [] }],
		};
		const stream = wrapResponseObjectAsSseStream(makeResponse([message]));
		const types = (await collect(stream)).map((e) => e.type);
		expect(types).toContain("response.content_part.added");
		expect(types).toContain("response.output_text.delta");
		expect(types).toContain("response.output_text.done");
		expect(types).toContain("response.content_part.done");
	});

	test("emits full event sequence for a complete Path D response (reasoning, function_call, function_call_output, message)", async () => {
		const reasoning: Reasoning = {
			id: "rs_1",
			type: "reasoning",
			summary: [],
			content: [{ type: "reasoning_text", text: "let me check" }],
			status: "completed",
		};
		const fnCall: FunctionCall = {
			type: "function_call",
			call_id: "call_1",
			name: "godex_chrome_list_pages",
			arguments: "{}",
			status: "completed",
		};
		const fnOut: FunctionCallOutput = {
			type: "function_call_output",
			call_id: "call_1",
			output: "[]",
			status: "completed",
		};
		const message: ResponseOutputMessage = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "no tabs", annotations: [] }],
		};
		const response = makeResponse([reasoning, fnCall, fnOut, message]);
		const stream = wrapResponseObjectAsSseStream(response);
		const types = (await collect(stream)).map((e) => e.type);

		// First and last events are the response shell.
		expect(types[0]).toBe("response.created");
		expect(types[1]).toBe("response.in_progress");
		expect(types[types.length - 1]).toBe("response.completed");

		// Each of the 4 items gets added + done.
		const added = types.filter((t) => t === "response.output_item.added");
		const done = types.filter((t) => t === "response.output_item.done");
		expect(added).toHaveLength(4);
		expect(done).toHaveLength(4);

		// reasoning, function_call arguments, output_text all present.
		expect(types).toContain("response.reasoning_text.delta");
		expect(types).toContain("response.function_call_arguments.delta");
		expect(types).toContain("response.output_text.delta");
	});

	test("output_index is 0 for the first item, 1 for the second, etc.", async () => {
		const message1: ResponseOutputMessage = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "first", annotations: [] }],
		};
		const message2: ResponseOutputMessage = {
			id: "msg_2",
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "second", annotations: [] }],
		};
		const response = makeResponse([message1, message2]);
		const stream = wrapResponseObjectAsSseStream(response);
		const events: unknown[] = [];
		const reader = stream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			events.push(value);
		}
		const added = events.filter(
			(e) => (e as { type: string }).type === "response.output_item.added",
		) as { output_index: number }[];
		expect(added.map((a) => a.output_index)).toEqual([0, 1]);
	});

	test("emits response.failed when the wrapped response status is failed", async () => {
		const response = makeResponse([], {
			status: "failed",
			error: { code: "rate_limit_exceeded", message: "Too many requests" },
		});
		const stream = wrapResponseObjectAsSseStream(response);
		const types = (await collect(stream)).map((e) => e.type);
		expect(types).toEqual([
			"response.created",
			"response.in_progress",
			"response.failed",
		]);
	});

	test("emits response.incomplete when the wrapped response status is incomplete", async () => {
		const response = makeResponse([], { status: "incomplete" });
		const stream = wrapResponseObjectAsSseStream(response);
		const types = (await collect(stream)).map((e) => e.type);
		expect(types[types.length - 1]).toBe("response.incomplete");
	});

	test("response.created and response.completed carry the response shell", async () => {
		const response = makeResponse([], {
			id: "resp_xyz",
			model: "minnimax.chat/MiniMax-M3",
		});
		const stream = wrapResponseObjectAsSseStream(response);
		const events: unknown[] = [];
		const reader = stream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			events.push(value);
		}
		const created = events.find(
			(e) => (e as { type: string }).type === "response.created",
		) as { response: ResponseObject };
		const completed = events.find(
			(e) => (e as { type: string }).type === "response.completed",
		) as { response: ResponseObject };
		expect(created.response.id).toBe("resp_xyz");
		expect(created.response.model).toBe("minnimax.chat/MiniMax-M3");
		expect(completed.response.id).toBe("resp_xyz");
	});
});
