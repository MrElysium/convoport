/**
 * 验证导入会话的事件序列能被真实 dsh-session 接受并正确回放。
 * 在 DSH 安装目录的 Node 环境下运行，import 真实的 @deepseek-ai/dsh-session
 * 的 Session 类（detached 模式）。事件序列与 lib/index.js importIntoSession 一致。
 *
 * 运行：node test/session-events.mjs
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const nodeReq = createRequire(process.execPath);
const req = createRequire(nodeReq.resolve("@deepseek-ai/dsh/package.json"));
const sessionMod = req("@deepseek-ai/dsh-session");
console.log("dsh-session loaded:", typeof sessionMod.Session);

// 与 lib/index.js importIntoSession 相同的数据
const picked = [
  { role: "user", content: "内存泄漏怎么查？", token_count: 12 },
  { role: "assistant", content: "用 heaptrack 或 jeprof。", token_count: 8 },
  { role: "user", content: "问题解决了，谢谢。", token_count: 5 }
];

// 构造 seed 事件（带完整 envelope：seq/time/surfaceOp），模拟 append 产物
const now = Date.now();
const events = [];
let seq = 0;
const push = (type, data, surfaceOp) => {
  const ev = { type, seq: seq++, time: now + seq, data };
  if (surfaceOp) ev.surfaceOp = surfaceOp;
  events.push(ev);
};

push("turn/start", { turn: 1 });
let turn = 1, step = 0;
for (const m of picked) {
  if (m.role === "assistant") {
    step++;
    push("assistant/message", {
      turn, step,
      message: {
        id: randomUUID(), role: "assistant",
        content: [{ type: "text", text: m.content }],
        source: { kind: "model", provider: "deepseek-official", model: "deepseek-web" }
      },
      usage: { inputTokens: 0, outputTokens: m.token_count }
    }, "append");
  } else {
    push("user/message", {
      id: randomUUID(), role: "user",
      content: [{ type: "text", text: m.content }],
      source: { kind: "user" }
    }, "append");
  }
}
push("turn/end", { turn, reason: { kind: "completed" } });

console.log("events:", events.map(e => e.type).join(" → "));

try {
  const session = sessionMod.Session.create("session-test-import-1", events);
  console.log("✅ Session.create accepted seed");
  const msgs = session.deriveMessages();
  console.log("derived:", msgs.map(m => `${m.role}: ${m.content[0].text}`).join(" | "));
  if (msgs.length !== picked.length) {
    console.error("❌ count mismatch:", msgs.length, "vs", picked.length);
    process.exit(1);
  }
  // 验证 role 顺序
  const roles = msgs.map(m => m.role);
  const expect = picked.map(m => m.role);
  if (roles.join(",") !== expect.join(",")) {
    console.error("❌ role order mismatch:", roles, "vs", expect);
    process.exit(1);
  }
  console.log("✅ session-events test passed");
} catch (e) {
  console.error("❌ rejected:", e && e.message ? e.message : e);
  process.exit(1);
}
