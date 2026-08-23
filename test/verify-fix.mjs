/**
 * 验证修复：token 回退启发式 + 时间戳规范化。
 * 直接 import 修复后的 lib/index.js，用临时目录驱动 CaptureStore.upsert。
 * 运行：node test/verify-fix.mjs
 */
import { CaptureStore } from "../lib/index.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dsc-verify-"));
const store = new CaptureStore(root);
await store.init();

const res = await store.upsert({
  source: "deepseek",
  url: "https://chat.deepseek.com/a/chat/s/verify-1",
  title: "verify",
  captured_at: new Date().toISOString(),
  messages: [
    { role: "user", content: "内存泄漏怎么查？", token_count: 0, message_id: 1, ts: 1787502251 },
    { role: "assistant", content: "用 heaptrack 或 jeprof。", token_count: 0, message_id: 2, ts: 1787502252 },
    { role: "user", content: "问题解决了，谢谢。", token_count: 12, message_id: 3, ts: "2026-08-24T10:00:00.000Z" }
  ]
});

const list = await store.list();
const session = JSON.parse(readFileSync(join(root, "sessions", `${res.id}.json`), "utf8"));

console.log("upsert result:", JSON.stringify(res));
console.log("index meta:", JSON.stringify(list[0]));
console.log("messages:", JSON.stringify(session.messages, null, 2));

let ok = true;
for (const m of session.messages) {
  if (!(m.token_count > 0)) { console.error(`❌ token_count <= 0 for ${m.role}: ${m.token_count}`); ok = false; }
  if (typeof m.ts !== "string" || !m.ts.includes("T")) { console.error(`❌ ts not ISO for ${m.role}: ${m.ts}`); ok = false; }
}
// 第 3 条官方计数 12 应被采信（不是启发式）
if (session.messages[2].token_count !== 12) { console.error(`❌ official count not honored: ${session.messages[2].token_count}`); ok = false; }

console.log(ok ? "✅ token/ts fix verified" : "❌ FAILED");
process.exit(ok ? 0 : 1);
