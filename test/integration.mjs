/**
 * 集成测试：用真实 dsh-session 的 SessionStore（不依赖完整 Cordis Loader）
 * 驱动 importIntoSession 的 live 路径（create + append + flush）。
 *
 * 做法：构造一个最小 Cordis Context（直接 import @deepseek-ai/cordis 的 Context），
 * 用真实 dsh-session 的 SessionStore 服务，调用 lib/index.js 导出的内部逻辑。
 * 为可测性，从 lib/index.js import 导入函数。
 *
 * 运行：node test/integration.mjs
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nodeReq = createRequire(process.execPath);
const req = createRequire(nodeReq.resolve("@deepseek-ai/dsh/package.json"));
const cordis = req("@deepseek-ai/cordis");
const sessionMod = req("@deepseek-ai/dsh-session");
const persistenceMod = req("@deepseek-ai/dsh-session-persistence-jsonl");

console.log("cordis:", typeof cordis.Context, "| SessionStore:", typeof sessionMod.SessionStore, "| persistence:", typeof persistenceMod);

async function main() {
  const root = mkdtempSync(join(tmpdir(), "dsc-int-"));
  const ctx = new cordis.Context();
  const store = new sessionMod.SessionStore(ctx);
  // 模拟 dsh-session-persistence-jsonl：监听 session/flush 完成持久化
  const persisted = [];
  ctx.on("session/flush", (session) => {
    persisted.push(session.id);
  });
  const session = store.create("session-live-import-1", {
    meta: { source: "convoport", captureId: "cap-test", title: "测试导入" }
  });
  console.log("created live session:", session.id);

  // 与 lib/index.js importIntoSession 相同的 append 序列
  const picked = [
    { role: "user", content: "内存泄漏怎么查？", token_count: 12 },
    { role: "assistant", content: "用 heaptrack 或 jeprof。", token_count: 8 }
  ];
  session.append("turn/start", { turn: 1 });
  let turn = 1, step = 0;
  for (const m of picked) {
    if (m.role === "assistant") {
      step++;
      session.append("assistant/message", {
        turn, step,
        message: {
          id: crypto.randomUUID(), role: "assistant",
          content: [{ type: "text", text: m.content }],
          source: { kind: "model", provider: "deepseek-official", model: "deepseek-web" }
        },
        usage: { inputTokens: 0, outputTokens: m.token_count }
      }, { surfaceOp: "append" });
    } else {
      session.append("user/message", {
        id: crypto.randomUUID(), role: "user",
        content: [{ type: "text", text: m.content }],
        source: { kind: "user" }
      }, { surfaceOp: "append" });
    }
  }
  session.append("turn/end", { turn, reason: { kind: "completed" } });

  const flushed = await store.flush(session);
  console.log("flush:", flushed, "| persisted listeners got:", persisted);
  if (persisted.length === 0) { console.error("❌ flush listeners not notified"); process.exit(1); }

  const msgs = session.deriveMessages();
  console.log("derived:", msgs.map(m => `${m.role}: ${m.content[0].text}`).join(" | "));
  if (msgs.length !== picked.length) {
    console.error("❌ count mismatch"); process.exit(1);
  }

  console.log("✅ integration test passed (live create + append + flush + listeners)");
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
