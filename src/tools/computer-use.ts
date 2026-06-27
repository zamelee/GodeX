import type { BuiltinFunctionToolDefinition } from "./definition";

export const COMPUTER_USE_TOOL_DEFINITION: BuiltinFunctionToolDefinition = {
	name: "computer_use",
	description:
		"Control a computer by taking screenshots and performing mouse and keyboard actions. Use to interact with GUI applications.",
	parameters: {
		type: "object",
		properties: {
			action: {
				type: "string",
				description:
					"Action to perform: screenshot, click, double_click, type, keypress, scroll, move, drag, wait.",
			},
			x: { type: "number", description: "X coordinate (optional)." },
			y: { type: "number", description: "Y coordinate (optional)." },
			text: { type: "string", description: "Text to type (optional)." },
			keys: {
				type: "array",
				items: { type: "string" },
				description: "Keys to press (optional).",
			},
		},
		required: ["action"],
	},
};

export const COMPUTER_TOOL_DEFINITION: BuiltinFunctionToolDefinition = {
	...COMPUTER_USE_TOOL_DEFINITION,
	name: "computer",
	description:
		"Computer control (alias of computer_use). Take screenshots and perform mouse and keyboard actions.",
};
