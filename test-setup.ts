// Bun test preload. Runs before any test file imports.
//
// Path D default: godex_chrome_* function declarations are auto-injected into
// every Responses request unless explicitly opted out. Most existing tests
// assert on exact upstream tool shapes, so we keep the default opt-in BEHAVIOR
// disabled in the test process. Individual tests that need auto-inject (e.g.
// the Path D tests in tool-plan.test.ts) toggle this back on via beforeEach.
process.env.GODEX_DISABLE_BROWSER_FUNCTION_INJECT = process.env.GODEX_DISABLE_BROWSER_FUNCTION_INJECT ?? "1";
