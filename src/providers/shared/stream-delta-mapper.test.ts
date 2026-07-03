import { describe, expect, test } from "bun:test";
import { mapCommonChatStreamDelta } from "./stream-delta-mapper";

describe("mapCommonChatStreamDelta", () => {
	test("maps reasoning content and provider tool call fragments", () => {
		expect(
			mapCommonChatStreamDelta({
				reasoning_content: "think",
				tool_calls: [
					{
						index: 1,
						id: "call_1",
						type: "function",
						function: {
							name: "lookup",
							arguments: '{"q":"x"}',
						},
					},
					{},
				],
			}),
		).toEqual([
			{ reasoning: "think" },
			{
				toolCall: {
					index: 1,
					id: "call_1",
					type: "function",
					name: "lookup",
					arguments: '{"q":"x"}',
				},
			},
		]);
	});

	test("omits empty tool call fragments", () => {
		expect(mapCommonChatStreamDelta({ tool_calls: [{}] })).toEqual([]);
	});
});

describe("mapCommonChatStreamDelta null tolerance", () => {
	test("drops null id/type/name/arguments like the field is absent", () => {
		// MiniMax sends continuation chunks with id=null, name=null and only
		// arguments carrying the new fragment. The bridge must never see null.
		const result = mapCommonChatStreamDelta({
			tool_calls: [
				{
					index: 0,
					id: null,
					type: null,
					function: { name: null, arguments: '{"command": ' },
				},
			],
		});
		expect(result).toEqual([
			{
				toolCall: {
					index: 0,
					arguments: '{"command": ',
				},
			},
		]);
	});

	test("never forwards null id or name to the bridge", () => {
		// Even if every name-bearing field is null, the mapper must omit it
		// rather than propagate the null downstream.
		const result = mapCommonChatStreamDelta({
			tool_calls: [
				{
					index: 0,
					id: null,
					type: "function",
					function: { name: null, arguments: "x" },
				},
			],
		});
		expect(result).toEqual([
			{
				toolCall: {
					index: 0,
					type: "function",
					arguments: "x",
				},
			},
		]);
		const first = result[0];
		expect(first).toBeDefined();
		const toolCall = (first as { toolCall: Record<string, unknown> }).toolCall;
		expect(toolCall).not.toHaveProperty("id");
		expect(toolCall).not.toHaveProperty("name");
	});

	test("preserves valid string fields alongside null siblings", () => {
		const result = mapCommonChatStreamDelta({
			tool_calls: [
				{
					index: 0,
					id: "call_abc",
					type: "function",
					function: { name: "shell_command", arguments: "" },
				},
			],
		});
		expect(result).toEqual([
			{
				toolCall: {
					index: 0,
					id: "call_abc",
					type: "function",
					name: "shell_command",
					arguments: "",
				},
			},
		]);
	});
});
