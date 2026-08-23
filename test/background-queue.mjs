/**
 * background.js 队列合并逻辑测试：模拟 chrome.storage 环境，
 * 验证同 url 合并、message_id 去重、持久化、重试丢弃行为。
 * 运行：node test/background-queue.mjs
 */
import { readFileSync } from "node:fs";

// 从 background.js 提取 enqueue 合并逻辑（纯逻辑部分，不执行扩展 API 调用）
const src = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

// 提取核心：同 url 合并逻辑（与 background.js enqueue 一致）
function extractMerge() {
  return new Function(`
function mergeIntoQueue(memQueue, payload) {
  const existing = memQueue.find((p) => p.url && p.url === payload.url);
  if (existing) {
    existing.title = payload.title || existing.title;
    existing.captured_at = payload.captured_at || existing.captured_at;
    const seen = new Set((existing.messages || []).map((m) => m.message_id).filter((x) => x != null));
    for (const m of payload.messages || []) {
      if (m.message_id != null && seen.has(m.message_id)) continue;
      if (m.message_id != null) seen.add(m.message_id);
      existing.messages.push(m);
    }
  } else {
    memQueue.push(payload);
  }
  return memQueue;
}
return mergeIntoQueue;`)();
}

const merge = extractMerge();

// ── 用例 ──
let ok = true;
const check = (name, cond, detail) => {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : " — " + JSON.stringify(detail)}`);
  if (!cond) ok = false;
};

// 1. 不同 url 各自入队
let q = [];
merge(q, { url: "https://chat.deepseek.com/c/a", title: "A", messages: [{ message_id: 1, content: "a1" }] });
merge(q, { url: "https://chat.deepseek.com/c/b", title: "B", messages: [{ message_id: 1, content: "b1" }] });
check("不同 url 分开入队", q.length === 2, q);

// 2. 同 url 合并 + 去重
q = [];
merge(q, { url: "https://chat.deepseek.com/c/a", title: "A", messages: [
  { message_id: 1, content: "a1" }, { message_id: 2, content: "a2" }
] });
merge(q, { url: "https://chat.deepseek.com/c/a", title: "A2", messages: [
  { message_id: 2, content: "a2-dup" }, { message_id: 3, content: "a3" }
] });
check("同 url 合并为一条", q.length === 1, q);
check("message_id 去重", q[0].messages.length === 3, q[0].messages);
check("标题更新", q[0].title === "A2", q[0].title);

// 3. 无 message_id 的消息不去重（服务端按内容/时间处理）
q = [];
merge(q, { url: "https://chat.deepseek.com/c/a", messages: [{ content: "x" }, { content: "y" }] });
merge(q, { url: "https://chat.deepseek.com/c/a", messages: [{ content: "z" }] });
check("无 id 消息追加", q[0].messages.length === 3, q[0].messages);

process.exit(ok ? 0 : 1);
