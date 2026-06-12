export function canonicalizeFunctionArguments(argumentsValue: string): string {
	if (argumentsValue === "") return argumentsValue;
	try {
		return JSON.stringify(JSON.parse(argumentsValue));
	} catch {
		return argumentsValue;
	}
}

export function isValidFunctionArguments(argumentsValue: string): boolean {
	if (argumentsValue === "") return true;
	try {
		const parsed = JSON.parse(argumentsValue);
		return parsed !== undefined;
	} catch {
		return false;
	}
}
