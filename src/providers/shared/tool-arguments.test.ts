import { describe, expect, test } from "bun:test";
import {
	canonicalizeFunctionArguments,
	isValidFunctionArguments,
} from "./tool-arguments";

describe("canonicalizeFunctionArguments", () => {
	test("returns empty string unchanged", () => {
		expect(canonicalizeFunctionArguments("")).toBe("");
	});

	test("rewrites non-canonical JSON in canonical form", () => {
		const result = canonicalizeFunctionArguments(
			`{ "city" : "Hangzhou"  , "unit":"c"  }`,
		);
		expect(JSON.parse(result)).toEqual({ city: "Hangzhou", unit: "c" });
		expect(result).not.toContain("  ");
	});

	test("preserves valid canonical JSON unchanged in payload", () => {
		const input = JSON.stringify({ a: 1, b: [1, 2] });
		expect(canonicalizeFunctionArguments(input)).toBe(input);
	});

	test("returns invalid JSON unchanged as fallback", () => {
		const broken = `{"input":`;
		expect(canonicalizeFunctionArguments(broken)).toBe(broken);
	});
});

describe("isValidFunctionArguments", () => {
	test("treats empty string as valid", () => {
		expect(isValidFunctionArguments("")).toBe(true);
	});

	test("detects valid JSON object", () => {
		expect(isValidFunctionArguments(`{"a":1}`)).toBe(true);
	});

	test("detects valid JSON primitives", () => {
		expect(isValidFunctionArguments("42")).toBe(true);
		expect(isValidFunctionArguments(`"hello"`)).toBe(true);
		expect(isValidFunctionArguments("true")).toBe(true);
		expect(isValidFunctionArguments("null")).toBe(true);
	});

	test("rejects malformed JSON", () => {
		expect(isValidFunctionArguments(`{"input":`)).toBe(false);
		expect(isValidFunctionArguments("{")).toBe(false);
	});
});
