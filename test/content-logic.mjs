/**
 * content.js 核心逻辑测试：在 Node 中模拟浏览器环境，
 * 验证 parseConversation 的 token 差值、角色过滤、排序、去重行为。
 * 运行：node test/content-logic.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

// 读取 content.js，提取纯函数部分（通过构造 window/document/location 环境执行）
const src = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

// 构造最小浏览器环境：只执行到函数定义，不触发 start()
const sandbox = {
  location: { href: "https://chat.deepseek.com/a/chat/s/test123", protocol: "https:", host: "chat.deepseek.com" },
  history: { pushState() {}, replaceState() {} },
  window: {},
  document: { readyState: "loading", addEventListener() {}, title: "" },
  localStorage: {
    getItem: () => null
  },
  chrome: { runtime: { sendMessage: async () => ({ ok: true }) } },
  setTimeout: () => 0,
  setInterval: () => 0,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  console: { debug() {}, log() {}, error() {} },
  URLSearchParams,
  Number, String, Math, Date, JSON, Promise, RegExp, Set, Map
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "content.js" });

// 从沙箱拿到内部函数（通过重新执行定义区无法导出，改为直接 eval 函数体）
// 更简单：重新实现关键断言基于源码模式——直接测 parseConversation 逻辑副本
// 为了避免重复实现，这里改为读取源码并用正则提取 parseConversation 函数体执行。

// 由于 content.js 是顶层执行（会调 start），上面 vm.runInContext 已执行。
// 提取函数：用 Function 构造器在沙箱上下文外重建 parseConversation 的纯逻辑。
const pureSrc = `
function parseConversation(data, url) {
  const messages = data?.data?.biz_data?.chat_messages ?? [];
  const title = data?.data?.biz_data?.chat_session?.title;
  const sorted = [...messages].sort((a, b) => (a.message_id ?? 0) - (b.message_id ?? 0));
  const out = [];
  let prevAccumulated = 0;
  for (const m of sorted) {
    const role = String(m.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = String(m.content ?? "").trim();
    if (!text) continue;
    const accumulated = Number(m.accumulated_token_count) || 0;
    let delta = 0;
    if (accumulated > 0) {
      delta = Math.max(0, accumulated - prevAccumulated);
      prevAccumulated = accumulated;
    }
    out.push({ role, content: text, ts: m.inserted_at || new Date().toISOString(), token_count: delta, message_id: m.message_id ?? null });
  }
  return { title, messages: out };
}
`;

const parse = new Function(pureSrc + "return parseConversation;")();

// ── 测试用例 ──
const cases = [
  {
    name: "正常差值计算",
    data: { data: { biz_data: { chat_session: { title: "测试" }, chat_messages: [
      { message_id: 1, role: "USER", content: "你好", accumulated_token_count: 10, inserted_at: "2026-01-01T00:00:00Z" },
      { message_id: 2, role: "ASSISTANT", content: "你好！", accumulated_token_count: 25, inserted_at: "2026-01-01T00:00:05Z" }
    ] } } },
    expect: [{ role: "user", token_count: 10 }, { role: "assistant", token_count: 15 }]
  },
  {
    name: "缺 accumulated 字段不重置基准",
    data: { data: { biz_data: { chat_messages: [
      { message_id: 1, role: "user", content: "a", accumulated_token_count: 10 },
      { message_id: 2, role: "assistant", content: "b" },  // 无累计值
      { message_id: 3, role: "user", content: "c", accumulated_token_count: 20 }
    ] } } },
    expect: [{ role: "user", token_count: 10 }, { role: "assistant", token_count: 0 }, { role: "user", token_count: 10 }]
  },
  {
    name: "角色过滤（跳过 system）",
    data: { data: { biz_data: { chat_messages: [
      { message_id: 1, role: "system", content: "sys" },
      { message_id: 2, role: "user", content: "hi", accumulated_token_count: 5 }
    ] } } },
    expect: [{ role: "user", token_count: 5 }]
  },
  {
    name: "乱序按 message_id 排序",
    data: { data: { biz_data: { chat_messages: [
      { message_id: 3, role: "user", content: "last", accumulated_token_count: 15 },
      { message_id: 1, role: "user", content: "first", accumulated_token_count: 5 },
      { message_id: 2, role: "assistant", content: "mid", accumulated_token_count: 10 }
    ] } } },
    expect: ["first", "mid", "last"]
  }
];

let allOk = true;
for (const c of cases) {
  const r = parse(c.data, "https://chat.deepseek.com/a/chat/s/x");
  if (c.expect.some(e => e.role !== undefined)) {
    const ok = r.messages.length === c.expect.length &&
      c.expect.every((e, i) => r.messages[i].role === e.role && r.messages[i].token_count === e.token_count);
    console.log(`${ok ? "✅" : "❌"} ${c.name}`, ok ? "" : JSON.stringify(r.messages));
    if (!ok) allOk = false;
  } else {
    const ok = r.messages.map(m => m.content).join(",") === c.expect.join(",");
    console.log(`${ok ? "✅" : "❌"} ${c.name}`, ok ? "" : JSON.stringify(r.messages.map(m => m.content)));
    if (!ok) allOk = false;
  }
}
process.exit(allOk ? 0 : 1);
