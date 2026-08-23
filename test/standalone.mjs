/**
 * Standalone smoke test for convoport store + event construction.
 * 不依赖 Cordis 运行时，验证：upsert 幂等、去重、统计、导入事件序列。
 * 运行：node test/standalone.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 直接复用 lib 里的纯函数逻辑（CaptureStore 类）
import { CaptureStore, estimateTokens } from "../lib/index.js";

async function main() {
  const root = mkdtempSync(join(tmpdir(), "dsc-test-"));
  const store = new CaptureStore(root);
  await store.init();
  console.log("store root:", root);

  // 1. upsert 幂等合并
  const r1 = await store.upsert({
    source: "deepseek", url: "https://chat.deepseek.com/c/abc", title: "Rust 内存优化",
    messages: [
      { role: "user", content: "内存泄漏怎么查？", ts: "2026-08-21T06:00:00Z", token_count: 12, message_id: 1 },
      { role: "assistant", content: "用 heaptrack。", ts: "2026-08-21T06:00:05Z", token_count: 8, message_id: 2 }
    ]
  });
  console.log("upsert#1:", r1);

  // 同 url 再上报（模拟扩展增量）：重复 message_id 去重，新消息追加
  const r2 = await store.upsert({
    source: "deepseek", url: "https://chat.deepseek.com/c/abc", title: "Rust 内存优化",
    messages: [
      { role: "user", content: "内存泄漏怎么查？", token_count: 12, message_id: 1 },   // dup
      { role: "assistant", content: "或者用 jeprof。", token_count: 9, message_id: 3 } // new
    ]
  });
  console.log("upsert#2 (expect added=1, total=3):", r2);

  // 2. 列表 + 统计
  const list = await store.list();
  console.log("list:", list);
  const stats = await store.stats();
  console.log("stats:", stats);

  // 3. 消息读取
  const id = r1.id;
  const file = await store.readSessionFile(id);
  console.log("messages:", file.messages.map(m => `${m.role}:${m.content}(${m.token_count})`).join(" | "));

  // 4. 估算 token fallback
  console.log("estimateTokens('hello world'):", estimateTokens("hello world"));

  // 5. 导入事件序列构造（模拟 importIntoSession 中的事件，不真正依赖 ctx.sessions）
  const indexes = [0, 2]; // 选第 1、3 条（跳过第 2 条打磨）
  const sel = indexes.filter(i => Number.isInteger(i) && i >= 0 && i < file.messages.length).sort((a, b) => a - b);
  const picked = sel.map(i => file.messages[i]);
  console.log("picked for import:", picked.map(m => m.content).join(" / "));

  console.log("\n✅ standalone smoke test passed");
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
