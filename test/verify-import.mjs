/**
 * 验证导入修复（端到端）：用真实 dsh-session 的 SessionStore 驱动
 * 修复后的 importIntoSession，验证：
 * 1) 导入的新会话落在「当前会话」的工作区（header.cwd）；
 * 2) 消息按「一轮问答」分组为多个 turn（turn/start…turn/end 成对，轮次递增）；
 * 3) 回放的派生消息顺序正确。
 * 运行：node test/verify-import.mjs
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importIntoSession, CaptureStore } from "../lib/index.js";

// 自动定位 dsh 安装：先按 node 可执行文件解析全局的 @deepseek-ai/dsh，
// 再锚定到 dsh 内部解析其嵌套依赖（cordis / dsh-session）。
const nodeReq = createRequire(process.execPath);
const dshPkg = nodeReq.resolve("@deepseek-ai/dsh/package.json");
const req = createRequire(dshPkg);
const cordis = req("@deepseek-ai/cordis");
const sessionMod = req("@deepseek-ai/dsh-session");

const ctx = new cordis.Context();
const sessions = new sessionMod.SessionStore(ctx);

// 当前会话（带工作目录）
const currentId = "session-current-verify";
sessions.create(currentId, { meta: { cwd: "C:\\coding", title: "current" } });

// 捕获存储：写入一段 3 轮问答（6 条消息）
const captureRoot = mkdtempSync(join(tmpdir(), "dsc-verify-"));
const store = new CaptureStore(captureRoot);
await store.init();
const upserted = await store.upsert({
  source: "deepseek",
  url: "https://chat.deepseek.com/a/chat/s/verify-group",
  title: "verify-group",
  captured_at: new Date().toISOString(),
  messages: [
    { role: "user", content: "问题1", message_id: 1, token_count: 5 },
    { role: "assistant", content: "回答1", message_id: 2, token_count: 6 },
    { role: "user", content: "问题2", message_id: 3, token_count: 5 },
    { role: "assistant", content: "回答2", message_id: 4, token_count: 6 },
    { role: "user", content: "问题3", message_id: 5, token_count: 5 },
    { role: "assistant", content: "回答3", message_id: 6, token_count: 6 }
  ]
});

// 调用真实 importIntoSession（全选 6 条 + 当前会话）
const result = await importIntoSession(ctx, store, {
  id: upserted.id,
  indexes: [0, 1, 2, 3, 4, 5],
  sessionId: currentId
});

const imported = sessions.get(result.sessionId);
if (!imported) {
  console.error("❌ imported session not found in store");
  process.exit(1);
}

// 1) cwd 归属当前工作区
if (imported.header.cwd !== "C:\\coding") {
  console.error("❌ cwd mismatch:", imported.header.cwd);
  process.exit(1);
}

// 2) turn 分组：turn/start…turn/end 成对、轮次递增，且每个 turn 内 user 在前
const events = imported.events;
const turnStarts = events.filter(e => e.type === "turn/start");
const turnEnds = events.filter(e => e.type === "turn/end");

if (turnStarts.length !== 3 || turnEnds.length !== 3) {
  console.error(`❌ expected 3 turns, got ${turnStarts.length} starts / ${turnEnds.length} ends`);
  process.exit(1);
}
const turns = turnStarts.map(e => e.data.turn);
if (turns.join(",") !== "1,2,3") {
  console.error("❌ turn numbers not 1,2,3:", turns.join(","));
  process.exit(1);
}
// 每个 turn 内：先 user/message，再 assistant/message，且 step 从 1 开始
let idx = 0;
for (let t = 1; t <= 3; t++) {
  if (events[idx++].type !== "turn/start") { console.error("❌ expected turn/start"); process.exit(1); }
  if (events[idx++].type !== "user/message") { console.error("❌ expected user/message"); process.exit(1); }
  const a = events[idx++];
  if (a.type !== "assistant/message" || a.data.step !== 1) { console.error("❌ expected assistant/message step=1"); process.exit(1); }
  if (events[idx++].type !== "turn/end") { console.error("❌ expected turn/end"); process.exit(1); }
}

// 3) 派生消息顺序正确
const derived = imported.deriveMessages();
const expect = ["问题1", "回答1", "问题2", "回答2", "问题3", "回答3"];
const got = derived.map(m => m.content[0].text);
if (got.join("|") !== expect.join("|")) {
  console.error("❌ derived order mismatch:", got.join("|"));
  process.exit(1);
}

console.log("✅ import cwd + turn grouping + replay verified (3 turns, 6 msgs)");
console.log("   result:", JSON.stringify(result));
process.exit(0);
