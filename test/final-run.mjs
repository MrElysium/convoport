/**
 * 最终完整跑通验证（真实 dsh web 3099）
 * 1. 插件健康 + 客户端 bundle
 * 2. 模拟扩展上报（10 条含连续 assistant）→ ingest
 * 3. 面板查询：sessions / stats / search
 * 4. 消息级导入（开头2+结尾2）→ 新建会话
 * 5. 会话落盘验证 → 清理
 */
import { readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3099";
// 无 cwd 会话落盘目录（导入未携带 sessionId 时会落在这里）
const noCwdDir = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "sessions", "_no-cwd");

async function main() {
  // 0. 幂等清理：删掉可能残留的 final-run cap
  try {
    const l0 = await fetch(`${BASE}/capture/sessions`).then(r => r.json());
    for (const s of l0.sessions || []) {
      if (s.url && s.url.includes("final-run")) {
        await fetch(`${BASE}/capture/sessions?id=${s.id}`, { method: "DELETE" });
        console.log("0. cleaned leftover cap:", s.id);
      }
    }
  } catch (e) { console.log("0. no leftovers:", e.message); }

  // 1. 插件健康
  const s = await fetch(`${BASE}/capture/stats`).then(r => r.json());
  console.log("1. stats:", JSON.stringify(s.stats));
  if (!s.ok) throw new Error("plugin not loaded");

  // 2. 客户端 bundle
  const c = await fetch(`${BASE}/plugins/convoport/client.js`).then(r => r.status);
  console.log("2. client bundle:", c === 200 ? "200 OK" : "FAIL " + c);

  // 3. 模拟扩展上报（10 条，含连续 assistant 打磨过程）
  const pairs = [
    ["user", "异步服务延迟高怎么排查？"], ["assistant", "先看调度器：测量 task 排队时间。"],
    ["assistant", "再看锁竞争，用 perf 采样。"], ["user", "排除了锁，怀疑饥饿。"],
    ["assistant", "用 trace 看 ready→run 延迟。"], ["user", "确实长尾。"],
    ["assistant", "加 fairness 配置试试。"], ["user", "有效，延迟下来了。"],
    ["assistant", "建议加监控告警。"], ["user", "好的，谢谢！"]
  ];
  const messages = pairs.map(([role, content], i) => ({
    role, content, message_id: i + 1, token_count: 10 + i, ts: `2026-08-21T13:0${i}:00Z`
  }));
  const d1 = await fetch(`${BASE}/capture/ingest`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "deepseek", url: "https://chat.deepseek.com/c/final-run", title: "最终跑通验证：异步优化", messages })
  }).then(r => r.json());
  console.log("3. ingest:", d1.added, "messages");

  // 4. 面板查询
  const l = await fetch(`${BASE}/capture/sessions`).then(r => r.json());
  const cap = l.sessions.find(x => x.url && x.url.includes("final-run"));
  if (!cap) throw new Error("capture not found after ingest");
  console.log("4. sessions:", cap.title, `${cap.messages}msgs`, `${cap.token_count}tk`);
  const st = await fetch(`${BASE}/capture/stats`).then(r => r.json());
  console.log("   stats:", `${st.stats.totalTokens}tk total,`, `${st.stats.conversations}conv`);
  const q = await fetch(`${BASE}/capture/search?q=${encodeURIComponent("饥饿")}`).then(r => r.json());
  console.log("5. search 饥饿:", q.hits.length, "hits");

  // 5. 消息级导入：开头2条 + 结尾2条（含连续 assistant 合并）
  const d2 = await fetch(`${BASE}/capture/import`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cap.id, indexes: [0, 1, 8, 9] })
  }).then(r => r.json());
  console.log("6. import:", `${d2.messagesInSession}msgs in session`, d2.sessionId);
  if (d2.messagesInSession !== 3) { throw new Error(`FAIL: expect 3 grouped, got ${d2.messagesInSession}`); }

  // 6. 会话落盘
  const dirs = readdirSync(noCwdDir);
  const found = dirs.filter(d => d.startsWith("session-dsc-"));
  console.log("7. session on disk:", found.length > 0 ? found.join(",") : "NONE");
  if (found.length === 0) throw new Error("FAIL: session not persisted");

  // 7. 清理
  await fetch(`${BASE}/capture/sessions?id=${cap.id}`, { method: "DELETE" });
  for (const d of found) rmSync(join(noCwdDir, d), { recursive: true, force: true });
  console.log("8. cleaned");

  console.log("\n✅ FINAL RUN PASSED — 完整链路跑通");
  process.exit(0);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
