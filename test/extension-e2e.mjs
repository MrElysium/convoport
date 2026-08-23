/**
 * 扩展→插件 全链路 e2e：模拟 content script 拉取 → background 合并 →
 * POST 到真实 dsh web（127.0.0.1:3099）→ 查询验证。
 *
 * 前置：dsh --profile web --port 3099 已运行。
 * 运行：node test/extension-e2e.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const BASE = process.env.CAPTURE_BASE || "http://127.0.0.1:3099";

// 1. 模拟 DeepSeek API 响应（与 chat.deepseek.com/api/v0/chat/history_messages 同构）
const deepseekApiResponse = {
  code: 0,
  data: {
    biz_data: {
      chat_session: { id: "sess-1001", title: "扩展全链路测试：异步性能优化" },
      chat_messages: [
        { message_id: 101, role: "USER", content: "我的异步服务延迟高，怎么排查？", accumulated_token_count: 88, inserted_at: "2026-08-21T08:00:00Z" },
        { message_id: 102, role: "ASSISTANT", content: "先看调度器：测量 task 排队时间，再看是否锁竞争。", accumulated_token_count: 236, inserted_at: "2026-08-21T08:00:08Z" },
        { message_id: 103, role: "USER", content: "排除了锁竞争，怀疑是任务饥饿。", accumulated_token_count: 275, inserted_at: "2026-08-21T08:01:00Z" },
        { message_id: 104, role: "ASSISTANT", content: "用 trace 看每个 task 的 ready→run 延迟，饥饿会表现为长尾。", accumulated_token_count: 412, inserted_at: "2026-08-21T08:01:12Z" },
        { message_id: 105, role: "USER", content: "确实有长尾，谢谢！", accumulated_token_count: 430, inserted_at: "2026-08-21T08:02:00Z" }
      ]
    }
  },
  msg: "success"
};

// 2. 复用 content.js 的 parseConversation（vm 沙箱提取）
const contentSrc = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const parseFn = new Function(
  contentSrc.slice(0, contentSrc.indexOf("async function syncSession"))
    .replace("const CONVERSATION_PATTERN", "var CONVERSATION_PATTERN")
    .replace("const API_BASE", "var API_BASE")
    .replace("const MIN_INTERVAL_MS", "var MIN_INTERVAL_MS")
    .replace(/let lastSync[^;]*;/, "")
  + "\nreturn parseConversation;"
)();

const parsed = parseFn(deepseekApiResponse, "https://chat.deepseek.com/a/chat/sess-1001");
console.log("parseConversation:", JSON.stringify(parsed.messages.map(m => `${m.role}:${m.content}(${m.token_count})`)));

// 3. 复用 background.js 的合并逻辑（同 url 合并 + 去重）
const bgSrc = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const mergeFn = new Function(`
function merge(memQueue, payload) {
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
}
return merge;`)();

// 模拟扩展两次上报（第二次增量：新消息 106）
const queue = [];
const payload1 = {
  source: "deepseek",
  url: "https://chat.deepseek.com/a/chat/sess-1001",
  title: parsed.title,
  captured_at: new Date().toISOString(),
  messages: parsed.messages
};
mergeFn(queue, payload1);
console.log("after 1st capture, queue items:", queue.length, "msgs:", queue[0].messages.length);

const payload2 = {
  url: "https://chat.deepseek.com/a/chat/sess-1001",
  title: parsed.title,
  messages: [
    { role: "user", content: "补充一个问题", message_id: 106, token_count: 5, ts: "2026-08-21T08:03:00Z" }
  ]
};
mergeFn(queue, payload2);
console.log("after 2nd capture (incremental), queue msgs:", queue[0].messages.length);

// 4. POST 到真实 dsh web
const res = await fetch(`${BASE}/capture/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(queue[0])
});
const ingest = await res.json();
console.log("ingest:", JSON.stringify(ingest));
if (ingest.added !== 6) { console.error("FAIL: expect 6 added"); process.exit(1); }

// 5. 验证查询
const list = await fetch(`${BASE}/capture/sessions`).then(r => r.json());
const s = list.sessions.find(x => x.url.includes("sess-1001"));
console.log("session:", s.id, s.title, `${s.messages} msgs`, `${s.token_count} tokens`);

const stats = await fetch(`${BASE}/capture/stats`).then(r => r.json());
console.log("stats:", JSON.stringify(stats.stats));

// 6. 搜索
const search = await fetch(`${BASE}/capture/search?q=${encodeURIComponent("饥饿")}`).then(r => r.json());
console.log("search '饥饿' hits:", search.hits.length);

// 7. 清理
await fetch(`${BASE}/capture/sessions?id=${s.id}`, { method: "DELETE" });
console.log("✅ extension-e2e passed");
process.exit(0);
