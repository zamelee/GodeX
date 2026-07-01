// simulate-reason-probe.cjs
// 模拟 studio-tauri/src-tauri/src/commands.rs 中的 test_reasoning 行为
// 当前实现:只尝试 reasoning_effort: "medium",不尝试 thinking
// 我们用 mock HTTP 服务模拟 4 种典型模型,看返回什么

const http = require('http');

// ===== Mock 1: 当前 test_reasoning 的行为 =====
async function test_reasoning_current(model, fetchFn) {
  // 跟 Rust 一致: POST /v1/chat/completions with reasoning_effort
  const body = {
    model,
    messages: [{role: "user", content: "1+1=?"}],
    max_tokens: 50,
    reasoning_effort: "medium",
  };
  const res = await fetchFn("/v1/chat/completions", body);
  if (res.ok) return "medium";
  return null;
}

// ===== Mock 2: 增强版(用户描述想要的"轮询"语义): 试 reasoning_effort,失败再试 thinking =====
async function test_reasoning_polling(model, fetchFn) {
  // 第一轮: reasoning_effort
  const body1 = {
    model,
    messages: [{role: "user", content: "1+1=?"}],
    max_tokens: 50,
    reasoning_effort: "medium",
  };
  const r1 = await fetchFn("/v1/chat/completions", body1);
  if (r1.ok) return "reasoning_effort=medium";

  // 第二轮: thinking (Anthropic 风格)
  const body2 = {
    model,
    messages: [{role: "user", content: "1+1=?"}],
    max_tokens: 200,
    thinking: {type: "enabled", budget_tokens: 100},
  };
  const r2 = await fetchFn("/v1/chat/completions", body2);
  if (r2.ok) return "thinking=100";

  return null;
}

// ===== Mock 4 种典型模型 =====
function makeMockFor(kind) {
  return async function mockFetch(path, body) {
    // 模拟 HTTP 客户端调用不同供应商
    if (kind === "openai-o1") {
      // OpenAI o1: 支持 reasoning_effort
      if (body.reasoning_effort) return {ok: true, status: 200, body: {choices: [{message: {content: "2"}}]}};
      return {ok: false, status: 400, body: {error: {message: "reasoning_effort not supported"}}};
    }
    if (kind === "claude-extended") {
      // Claude: 不认 reasoning_effort(400),但认 thinking(200)
      if (body.reasoning_effort) return {ok: false, status: 400, body: {error: {message: "unknown parameter reasoning_effort"}}};
      if (body.thinking) return {ok: true, status: 200, body: {content: [{text: "2"}]}};
      return {ok: false, status: 400};
    }
    if (kind === "minimax-M2.7") {
      // MiniMax: 可能接受 reasoning_effort 但不支持;也接受 thinking 但返回一般
      // 假设两者都不支持
      if (body.reasoning_effort) return {ok: false, status: 422, body: {error: {message: "param not allowed"}}};
      if (body.thinking) return {ok: false, status: 422, body: {error: {message: "param not allowed"}}};
      // 纯文本 OK
      return {ok: true, status: 200, body: {choices: [{message: {content: "2"}}]}};
    }
    if (kind === "gpt-5.4") {
      // GPT-5.4: 双支持
      if (body.reasoning_effort || body.thinking) return {ok: true, status: 200, body: {choices: [{message: {content: "2"}}]}};
      return {ok: true, status: 200};
    }
    return {ok: false, status: 500};
  };
}

const MODELS = [
  {name: "openai-o1",       desc: "OpenAI o1 系列 — 只认 reasoning_effort"},
  {name: "claude-extended", desc: "Claude extended — 只认 thinking(不认 reasoning_effort)"},
  {name: "minimax-M2.7",    desc: "MiniMax M2.7 — 两者都不认"},
  {name: "gpt-5.4",         desc: "GPT-5.4 — 两者都认"},
];

(async () => {
  console.log('========================================================');
  console.log('  simulation of test_reasoning() for 4 model profiles');
  console.log('========================================================');
  console.log('');
  console.log('--- CURRENT behavior (only tries reasoning_effort) ---');
  for (const m of MODELS) {
    const mock = makeMockFor(m.name);
    const result = await test_reasoning_current(m.name, mock);
    console.log('  ' + m.name.padEnd(18) + ' => ' + (result === null ? 'NULL (不支持)' : '"' + result + '"'));
  }
  console.log('');
  console.log('--- POLLING behavior (tries reasoning_effort, then thinking) ---');
  for (const m of MODELS) {
    const mock = makeMockFor(m.name);
    const result = await test_reasoning_polling(m.name, mock);
    console.log('  ' + m.name.padEnd(18) + ' => ' + (result === null ? 'NULL (都不支持)' : '"' + result + '"'));
  }
  console.log('');
  console.log('========================================================');
  console.log('  summary');
  console.log('========================================================');
  console.log('');
  console.log('CURRENT 行为结论:');
  console.log('  - 只探测 reasoning_effort (OpenAI 风格)');
  console.log('  - Claude extended 模型返回 NULL(被误判为不支持)');
  console.log('  - 你之前问过"reasoning vs thinking 拆不拆",答案是:');
  console.log('    拆 UI 没必要,但 Rust 端 polling 应该两种都试,任一成功就标 true');
  console.log('');
  console.log('POLLING 行为结论:');
  console.log('  - 先试 reasoning_effort(OpenAI 风格)');
  console.log('  - 失败再试 thinking(Anthropic 风格)');
  console.log('  - 任一成功返回对应模式名;都失败返回 null');
  console.log('  - Claude extended 模型被正确识别');
  console.log('');
  console.log('代码层改动建议(如果你同意的话):');
  console.log('  修改 studio-tauri/src-tauri/src/commands.rs 的 test_reasoning:');
  console.log('  - 添加第二轮 thinking 探测');
  console.log('  - 返回 Some("reasoning_effort") 或 Some("thinking") 表示支持,None 表示都不支持');
  console.log('  - UI cap-reason 复选框保留单个(不拆),保留 B=不拆 的决策');
})();
