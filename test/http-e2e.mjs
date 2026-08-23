/**
 * HTTP 端到端测试（轻量 ctx）：mock 提供 webServer/commands/skills 桩，
 * 捕获插件注册的 /capture 路由 handler，用真实 node:http 服务器包装驱动，
 * 会话用真实 dsh-session 的 SessionStore。
 *
 * 走完整链路：ingest → stats → sessions → messages → import（消息级选择）。
 *
 * 运行：node test/http-e2e.mjs
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nodeReq = createRequire(process.execPath);
const req = createRequire(nodeReq.resolve("@deepseek-ai/dsh/package.json"));
const cordis = req("@deepseek-ai/cordis");
const sessionMod = req("@deepseek-ai/dsh-session");

import { apply } from "../lib/index.js";

async function main() {
  const root = mkdtempSync(join(tmpdir(), "dsc-http-"));
  // 插件读取 process.env.DSH_HOME：测试进程内重定向到临时目录，避免污染真实数据
  process.env.DSH_HOME = root;
  const env = { DSH_HOME: root };

  // ── 轻量 ctx：捕获插件注册的路由与命令 ──
  let captureHandler = null;
  let registerCalls = { commands: [], skills: [] };
  const ctx = {
    env,
    on: () => {},
    inject: (deps, fn) => {
      if (deps.includes("webServer")) {
        // 回调收到子 ctx，服务作为其属性（与 Cordis ctx.inject 语义一致）
        fn({ webServer: { register: (route) => { captureHandler = route.handler; return () => {}; } } });
      }
      return () => {};
    },
    commands: {
      register: (def) => { registerCalls.commands.push(def); return () => {}; }
    },
    skills: {
      register: (skill) => { registerCalls.skills.push(skill); return () => {}; }
    },
    sessions: new sessionMod.SessionStore(new cordis.Context())
  };

  apply(ctx);
  if (!captureHandler) throw new Error("capture handler not registered");
  console.log("plugin applied; commands:", registerCalls.commands.map(c => c.name), "| skills:", registerCalls.skills.map(s => s.name));

  // ── 用 node:http 包装 handler ──
  const server = createServer((req, res) => captureHandler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log("server on", base);

  const j = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json() };
  };

  // 1. 扩展上报（10 条消息，模拟打磨过程）
  const messages = [];
  const pairs = [
    ["user", "内存泄漏怎么查？"], ["assistant", "分三步排查：JoinSet、jeprof、二分注释"],
    ["user", "jeprof 看不出热点"], ["assistant", "看长生命周期容器：连接池和缓存"],
    ["user", "请求结束 RSS 不回落"], ["assistant", "可能是 Arc 循环引用，用 weak_count 断言"],
    ["user", "找到了，连接池 get 没配对 put"], ["assistant", "用 RAII guard 包裹连接借用"],
    ["user", "修复后压测 3 小时稳定，谢谢"], ["assistant", "建议接入 tokio-console 日常监控"]
  ];
  pairs.forEach(([role, content], i) => {
    messages.push({ role, content, message_id: i + 1, token_count: 10 + i, ts: `2026-08-21T0${Math.floor(i / 6)}:${(i % 6) * 10}:00Z` });
  });

  const r1 = await j("POST", "/capture/ingest", {
    source: "deepseek", url: "https://chat.deepseek.com/c/abc123", title: "Rust 内存优化",
    messages
  });
  console.log("ingest:", r1.status, JSON.stringify(r1.data));
  if (r1.data.added !== 10) throw new Error("ingest added != 10");

  // 2. 重复上报（幂等去重：message_id 1 重复、11 新增）
  const r1b = await j("POST", "/capture/ingest", {
    url: "https://chat.deepseek.com/c/abc123", title: "Rust 内存优化",
    messages: [messages[0], { role: "user", content: "新问题", message_id: 11, token_count: 3 }]
  });
  console.log("ingest#2 (expect added=1 total=11):", JSON.stringify(r1b.data));
  if (r1b.data.added !== 1) throw new Error("dedup failed");

  // 3. 统计
  const r2 = await j("GET", "/capture/stats");
  console.log("stats:", JSON.stringify(r2.data.stats));
  if (r2.data.stats.conversations !== 1) throw new Error("stats wrong");

  // 4. 会话列表
  const r3 = await j("GET", "/capture/sessions");
  const capId = r3.data.sessions[0].id;
  console.log("sessions:", JSON.stringify(r3.data.sessions.map(s => ({ id: s.id, title: s.title, n: s.messages }))));

  // 5. 消息详情
  const r4 = await j("GET", `/capture/messages?id=${capId}`);
  console.log("messages count:", r4.data.session.messages.length);
  if (r4.data.session.messages.length !== 11) throw new Error("messages != 11");

  // 6. 消息级导入：只选开头 2 条 + 结尾 2 条（跳过中间打磨）
  const indexes = [0, 1, 8, 9];
  const r5 = await j("POST", "/capture/import", { id: capId, indexes });
  console.log("import:", JSON.stringify(r5.data));
  if (r5.data.importedMessages !== 4) throw new Error("import != 4");
  if (!r5.data.sessionId) throw new Error("no sessionId");

  // 7. 导入后状态
  const r6 = await j("GET", "/capture/sessions");
  console.log("after import, imported flag:", r6.data.sessions[0].imported);
  if (r6.data.sessions[0].imported !== true) throw new Error("imported flag not set");

  // 8. 全文搜索（SQLite FTS5 或降级 LIKE）
  const r7 = await j("GET", "/capture/search?q=内存");
  console.log("search '内存' hits:", r7.data.hits.length);
  if (r7.data.hits.length === 0) throw new Error("search found nothing");

  // 9. 命令与 skill 注册了
  if (registerCalls.commands.length !== 1 || registerCalls.skills.length !== 1) throw new Error("register counts wrong");

  // 10. headless 模式兼容：无 webServer 时插件仍可加载（只注册命令/skill）
  const ctxNoWeb = {
    env, on: () => {}, inject: () => () => {},
    commands: { register: (d) => { registerCalls.commands.push(d); return () => {}; } },
    skills: { register: (s) => { registerCalls.skills.push(s); return () => {}; } },
    sessions: new sessionMod.SessionStore(new cordis.Context())
  };
  let noThrow = true;
  try { apply(ctxNoWeb); } catch (e) { noThrow = false; console.error("headless apply threw:", e.message); }
  if (!noThrow) throw new Error("plugin should load without webServer (headless)");

  console.log("\n✅ HTTP e2e test passed");
  server.close();
  setTimeout(() => process.exit(0), 200);
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
