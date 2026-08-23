/**
 * 边界测试：连续 assistant 消息（无 user 间隔）是否被 dsh-session 接受。
 * DeepSeek 对话可能产生连续 assistant 消息；若 dsh-session 拒绝，
 * importIntoSession 需要合并连续同角色消息（ctxport 的做法）。
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const nodeReq = createRequire(process.execPath);
const req = createRequire(nodeReq.resolve("@deepseek-ai/dsh/package.json"));
const sessionMod = req("@deepseek-ai/dsh-session");

const cases = [
  {
    name: "连续 assistant（A→A）",
    picked: [
      { role: "user", content: "帮我写个函数", token_count: 10 },
      { role: "assistant", content: "第一步：定义签名。", token_count: 10 },
      { role: "assistant", content: "第二步：实现逻辑。", token_count: 12 }
    ]
  },
  {
    name: "连续 user（U→U）",
    picked: [
      { role: "user", content: "问题一", token_count: 5 },
      { role: "user", content: "问题二补充", token_count: 6 },
      { role: "assistant", content: "两个一起答。", token_count: 9 }
    ]
  }
];

for (const c of cases) {
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
  for (const m of c.picked) {
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

  try {
    const session = sessionMod.Session.create("session-edge-" + seq, events);
    const msgs = session.deriveMessages();
    console.log(`✅ ${c.name}: accepted, derived ${msgs.length} msgs`);
  } catch (e) {
    console.log(`❌ ${c.name}: REJECTED — ${e && e.message}`);
  }
}
