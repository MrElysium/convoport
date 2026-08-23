/**
 * 验证「导入会话挂到工作区」：mock workspaceRegistry，确认 importIntoSession
 * 会按 cwd 解析工作区并调用 attachSession，从而不落入「未分组」。
 * 运行：node test/verify-attach.mjs
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importIntoSession, CaptureStore } from "../lib/index.js";

const nodeReq = createRequire(process.execPath);
const req = createRequire(nodeReq.resolve("@deepseek-ai/dsh/package.json"));
const cordis = req("@deepseek-ai/cordis");
const sessionMod = req("@deepseek-ai/dsh-session");

const sessions = new sessionMod.SessionStore(new cordis.Context());
sessions.create("session-current-verify", { meta: { cwd: "C:\\coding", title: "current" } });

const captureRoot = mkdtempSync(join(tmpdir(), "dsc-attach-"));
const store = new CaptureStore(captureRoot);
await store.init();
const upserted = await store.upsert({
  source: "deepseek",
  url: "https://chat.deepseek.com/a/chat/s/verify-attach",
  title: "verify-attach",
  captured_at: new Date().toISOString(),
  messages: [
    { role: "user", content: "问题", message_id: 1, token_count: 5 },
    { role: "assistant", content: "回答", message_id: 2, token_count: 6 }
  ]
});

// mock workspaceRegistry：记录 resolveByPath 与 attachSession 的调用
const calls = [];
const mockWorkspace = {
  async attachSession(sessionId) {
    calls.push({ op: "attach", path: this.path, sessionId });
  }
};
const mockRegistry = {
  async resolveByPath(path) {
    calls.push({ op: "resolve", path });
    return { ...mockWorkspace, path };
  }
};

const ctx = {
  sessions,
  get: (name) => (name === "workspaceRegistry" ? mockRegistry : undefined)
};

const result = await importIntoSession(ctx, store, {
  id: upserted.id,
  indexes: [0, 1],
  sessionId: "session-current-verify"
});

console.log("calls:", JSON.stringify(calls));
console.log("result:", JSON.stringify(result));

const resolveCall = calls.find(c => c.op === "resolve");
const attachCall = calls.find(c => c.op === "attach");
if (!resolveCall || resolveCall.path !== "C:\\coding") {
  console.error("❌ resolveByPath not called with cwd");
  process.exit(1);
}
if (!attachCall || attachCall.sessionId !== result.sessionId) {
  console.error("❌ attachSession not called with imported session id");
  process.exit(1);
}
console.log("✅ workspace attach verified");
process.exit(0);
