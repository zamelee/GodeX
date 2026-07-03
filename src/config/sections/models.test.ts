import { describe, expect, test } from "bun:test";
import { parseModelsConfig } from "./models";

describe("parseModelsConfig", () => {
	test("returns aliases when every target references a configured provider", () => {
		expect(
			parseModelsConfig(
				{ aliases: { "*": "zhipu/glm-4", deepseek: "deepseek/chat" } },
				new Set(["zhipu", "deepseek"]),
			),
		).toEqual({
			aliases: { "*": "zhipu/glm-4", deepseek: "deepseek/chat" },
		});
	});

	test("returns undefined when aliases are not configured", () => {
		expect(parseModelsConfig(undefined, new Set(["zhipu"]))).toBeUndefined();
		expect(parseModelsConfig({}, new Set(["zhipu"]))).toBeUndefined();
	});

	test("rejects alias keys that contain provider separators", () => {
		expect(() =>
			parseModelsConfig(
				{ aliases: { "deepseek/chat": "deepseek/chat" } },
				new Set(["deepseek"]),
			),
		).toThrow('models.aliases.deepseek/chat: alias key must not contain "/"');
	});

	test("rejects aliases with non-string targets", () => {
		expect(() =>
			parseModelsConfig({ aliases: { deepseek: 51 } }, new Set(["deepseek"])),
		).toThrow("models.aliases.deepseek must be a string");
	});

	test("rejects aliases without provider/model targets", () => {
		expect(() =>
			parseModelsConfig(
				{ aliases: { deepseek: "deepseek" } },
				new Set(["deepseek"]),
			),
		).toThrow(
			'models.aliases.deepseek: value must be "provider/model" format, got "deepseek"',
		);
	});

	test("rejects aliases with an empty provider segment", () => {
		expect(() =>
			parseModelsConfig(
				{ aliases: { deepseek: "/chat" } },
				new Set(["deepseek"]),
			),
		).toThrow('models.aliases.deepseek: value must be "provider/model" format');
	});

	test("rejects aliases that reference unconfigured providers", () => {
		expect(() =>
			parseModelsConfig(
				{ aliases: { deepseek: "unknown/chat" } },
				new Set(["deepseek"]),
			),
		).toThrow('models.aliases.deepseek: provider "unknown" is not configured');
	});

	test("uses a null-prototype alias map", () => {
		const protoKey = "__proto__";
		const constructorKey = "constructor";
		const aliases = Object.create(null) as Record<string, unknown>;
		aliases[protoKey] = "deepseek/chat";
		aliases[constructorKey] = "deepseek/reasoner";

		const models = parseModelsConfig({ aliases }, new Set(["deepseek"]));
		const aliasMap = models?.aliases;

		expect(aliasMap).toBeDefined();
		expect(Object.getPrototypeOf(aliasMap)).toBeNull();
		expect(Object.hasOwn(aliasMap ?? {}, protoKey)).toBe(true);
		expect(aliasMap?.[protoKey]).toBe("deepseek/chat");
		expect(aliasMap?.[constructorKey]).toBe("deepseek/reasoner");
	});
});

describe("parseModelsConfig enabled[]", () => {
	test("expands enabled[] into aliases with provider/model keys", () => {
		const out = parseModelsConfig(
			{
				enabled: [
					{ provider: "zhipu", model: "glm-4" },
					{
						provider: "zhipu",
						model: "glm-5",
						context_window: 128000,
						max_tokens: 8192,
					},
				],
			},
			new Set(["zhipu"]),
		);
		expect(out).toBeDefined();
		expect(out?.aliases).toEqual({
			"zhipu/glm-4": "zhipu/glm-4",
			"zhipu/glm-5": "zhipu/glm-5",
		});
		expect(out?.enabled).toEqual([
			{ provider: "zhipu", model: "glm-4" },
			{
				provider: "zhipu",
				model: "glm-5",
				context_window: 128000,
				max_tokens: 8192,
			},
		]);
	});

	test("user aliases override enabled[] expansion", () => {
		const out = parseModelsConfig(
			{
				aliases: { myfast: "zhipu/glm-4" },
				enabled: [{ provider: "zhipu", model: "glm-4" }],
			},
			new Set(["zhipu"]),
		);
		// 'myfast' is the explicit user alias; the auto-expanded "zhipu/glm-4" is also present
		expect(out?.aliases).toEqual({
			myfast: "zhipu/glm-4",
			"zhipu/glm-4": "zhipu/glm-4",
		});
	});

	test("accepts capabilities object on enabled items", () => {
		const out = parseModelsConfig(
			{
				enabled: [
					{
						provider: "zhipu",
						model: "glm-4v",
						capabilities: { text: true, image_input: true, tool_use: false },
					},
				],
			},
			new Set(["zhipu"]),
		);
		expect(out!.enabled![0]!.capabilities).toEqual({
			text: true,
			image_input: true,
			tool_use: false,
		});
	});

	test("accepts margin on enabled items", () => {
		const out = parseModelsConfig(
			{
				enabled: [
					{
						provider: "zhipu",
						model: "glm-4v",
						margin: 0.8,
					},
				],
			},
			new Set(["zhipu"]),
		);
		expect(out!.enabled![0]!.margin).toBe(0.8);
	});
	test("rejects enabled entry with unknown provider", () => {
		expect(() =>
			parseModelsConfig(
				{ enabled: [{ provider: "ghost", model: "x" }] },
				new Set(["zhipu"]),
			),
		).toThrow('models.enabled[0]: provider "ghost" is not configured');
	});

	test("rejects enabled entry missing model", () => {
		expect(() =>
			parseModelsConfig(
				{ enabled: [{ provider: "zhipu" }] },
				new Set(["zhipu"]),
			),
		).toThrow("models.enabled[0] must have string provider and model");
	});

	test("returns undefined when neither aliases nor enabled are configured", () => {
		expect(parseModelsConfig({}, new Set(["zhipu"]))).toBeUndefined();
	});
});
