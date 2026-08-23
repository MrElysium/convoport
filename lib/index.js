/**
 * dsh-deepseek-capture — DeepSeek Harness「DeepSeek 对话捕获」插件（服务端半区）
 *
 * 1. 接收浏览器扩展上报的 DeepSeek 网页对话（POST /capture/ingest），
 *    100% 本地存储：$DSH_HOME/capture/ 下 JSON 文件（每会话一个文件 + 索引）。
 * 2. 提供资产查询与统计（GET /capture/sessions|messages|stats）。
 * 3. 消息级选择导入（POST /capture/import）：把选中消息按顺序写入新建的
 *    Harness 会话（ctx.sessions.create + append 事件 + flush），
 *    选中消息成为该会话的历史记录，可继续对话。
 * 4. 注册 /capture 命令：人类在 Web 输入框输入 /capture 查看统计概览。
 *
 * 客户端半区（侧边栏「DeepSeek 捕获」面板）见 lib/client.js。
 */

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const CMD_NAME = "capture";

const SKILL_NAME = "deepseek-capture";

const SKILL_DESCRIPTION =
  "当用户想查看 DeepSeek 网页版对话的捕获记录、节省的 Token 统计、或把捕获的对话导入当前工作区会话时使用。触发词：捕获、DeepSeek 对话、节省 Token、导入对话。";

const SKILL_WHEN_TO_USE =
  "用户提到「DeepSeek 捕获」「捕获的对话」「节省了多少 token」「把那段 DeepSeek 对话导进来」等场景。";

const SKILL_CONTENT = [
  "## deepseek-capture — DeepSeek 对话捕获资产",
  "",
  "浏览器扩展自动捕获 chat.deepseek.com 的对话，数据 100% 本地存储在 `$DSH_HOME/capture/`（JSON，每会话一个文件，开发者可直接查看）。",
  "",
  "### 查询方式",
  "- 统计概览：用户可直接在 Web 输入框输入 `/capture` 命令查看（累计 Token/对话数/今日捕获/估算金额）。",
  "- 原始 JSON：捕获数据在 `$DSH_HOME/capture/sessions/<id>.json`，可用 read 工具读取；索引在 `$DSH_HOME/capture/index.json`。",
  "",
  "### 导入",
  "- 用户可通过侧边栏「DeepSeek 捕获」面板按消息挑选导入；导入 = 新建 Harness 会话，选中消息成为历史。",
  "- 若用户直接要求导入某段捕获对话，可先 read 对应 JSON 文件拿到消息，再按用户指定的消息范围构造内容。"
].join("\n");

/** 固定的估算单价（$ / 1k tokens），仅用于统计页展示参考。 */
const USD_PER_1K_TOKENS = 0.02;

/** 估算 token：优先用上报的官方计数，否则用 Harness 同款 4 字符/token 启发式。 */
function estimateTokens(text) {
  if (typeof text !== "string") return 0;
  return Math.ceil(text.length / 4) + 4;
}

/** 规范化时间戳：DeepSeek `inserted_at` 是 Unix 秒级时间戳，统一转成 ISO 字符串。 */
function normalizeTs(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toISOString();
  }
  return typeof ts === "string" && ts ? ts : new Date().toISOString();
}

/** 单条消息 token：官方计数为正数时采信，否则回退到 4 字符/token 启发式。 */
function tokenCount(m) {
  const official = Number(m && m.token_count);
  if (Number.isFinite(official) && official > 0) return official;
  return estimateTokens(m && m.content);
}

function captureDir(env) {
  return join(env.DSH_HOME || join(homedir(), ".dsh"), "capture");
}
function sessionsDir(dir) {
  return join(dir, "sessions");
}
function indexPath(dir) {
  return join(dir, "index.json");
}
function sessionPath(dir, id) {
  return join(sessionsDir(dir), `${id}.json`);
}

/**
 * 轻量 JSON 文件存储（权威数据源）+ 可选 SQLite 全文索引（搜索加速）。
 * JSON 开发者可读、零依赖；SQLite 用 node:sqlite FTS5，Node 22.5+ 可用，
 * 不可用时自动降级为纯 JSON（搜索退化为 LIKE 扫描或不可用）。
 */
class CaptureStore {
  constructor(root) {
    this.root = root;
    this.sessions = sessionsDir(root);
    this.sqlite = null;   // lazy：仅在 init 时尝试打开
    this.sqliteOk = false;
  }

  async init() {
    await mkdir(this.sessions, { recursive: true });
    try {
      await readFile(indexPath(this.root), "utf8");
    } catch {
      await this.writeIndex({ version: 1, sessions: {} });
    }
    this.sqliteOk = await this.initSqlite();
    if (!this.sqliteOk) {
      console.warn("[dsh-deepseek-capture] node:sqlite unavailable — search disabled (JSON store still works)");
    }
  }

  /** 尝试打开 SQLite 并建 FTS5 索引；失败返回 false（Node <22.5 或平台限制）。 */
  async initSqlite() {
    try {
      const { DatabaseSync } = await import("node:sqlite");
      this.sqlite = new DatabaseSync(join(this.root, "capture.db"));
      this.sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS capture_fts USING fts5(session_id, role, content, ts);
        CREATE TABLE IF NOT EXISTS capture_fts_meta (session_id TEXT PRIMARY KEY, title TEXT, updated_at TEXT);
      `);
      return true;
    } catch {
      this.sqlite = null;
      return false;
    }
  }

  /** 为新消息批量建索引（upsert 后调用）。 */
  indexMessages(id, title, messages) {
    if (!this.sqlite) return;
    const stmt = this.sqlite.prepare(
      "INSERT INTO capture_fts (session_id, role, content, ts) VALUES (?, ?, ?, ?)"
    );
    for (const m of messages) {
      stmt.run(id, m.role || "", m.content || "", m.ts || "");
    }
    this.sqlite.prepare(
      "INSERT INTO capture_fts_meta (session_id, title, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at"
    ).run(id, title || "", new Date().toISOString());
  }

  /** 从索引移除会话。 */
  deindexSession(id) {
    if (!this.sqlite) return;
    this.sqlite.prepare("DELETE FROM capture_fts WHERE session_id = ?").run(id);
    this.sqlite.prepare("DELETE FROM capture_fts_meta WHERE session_id = ?").run(id);
  }

  /** 全文搜索：FTS5 命中 + LIKE 兜底合并（FTS5 unicode61 对中文整句分词差，
   *  本地小数据集用 LIKE 保证子串召回；去重后按 ts 倒序）。返回
   *  {sessionId,title,role,content,ts}[] */
  async search(query, limit = 20) {
    const q = String(query || "").trim();
    if (!q) return [];
    const byKey = new Map();
    const add = (row) => {
      const key = `${row.session_id}:${row.content}`;
      if (!byKey.has(key)) byKey.set(key, row);
    };
    if (this.sqlite) {
      const tokens = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '""')}"`);
      const match = tokens.join(" AND ");
      try {
        const rows = this.sqlite.prepare(
          `SELECT f.session_id, m.title, f.role, f.content, f.ts
           FROM capture_fts f LEFT JOIN capture_fts_meta m ON m.session_id = f.session_id
           WHERE capture_fts MATCH ? LIMIT ?`
        ).all(match, limit * 2);
        for (const r of rows) add(r);
      } catch {
        // MATCH 语法错误等：忽略，走 LIKE
      }
    }
    // LIKE 兜底（覆盖中文子串场景）
    const index = await this.readIndex();
    for (const meta of Object.values(index.sessions)) {
      const file = await this.readSessionFile(meta.id);
      for (const m of file.messages || []) {
        if ((m.content || "").includes(q)) {
          add({ session_id: meta.id, title: meta.title, role: m.role, content: m.content, ts: m.ts });
        }
      }
    }
    const out = [...byKey.values()].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
    return out.slice(0, limit);
  }

  async readIndex() {
    try {
      return JSON.parse(await readFile(indexPath(this.root), "utf8"));
    } catch {
      return { version: 1, sessions: {} };
    }
  }

  async writeIndex(index) {
    await writeFile(indexPath(this.root), JSON.stringify(index, null, 2), "utf8");
  }

  /** 按 URL 幂等 upsert：同 url 复用同 id（扩展重复上报同一会话时合并）。 */
  async upsert(entry) {
    const index = await this.readIndex();
    let id = null;
    for (const [k, v] of Object.entries(index.sessions)) {
      if (v.url === entry.url && entry.url) { id = k; break; }
    }
    if (!id) {
      id = "cap-" + randomUUID().slice(0, 8);
      index.sessions[id] = {
        id, source: entry.source || "deepseek", url: entry.url || "",
        title: entry.title || "未命名对话", captured_at: entry.captured_at || new Date().toISOString(),
        messages: 0, token_count: 0, imported: false
      };
    }
    const meta = index.sessions[id];
    meta.title = entry.title || meta.title;
    meta.source = entry.source || meta.source;
    meta.url = entry.url || meta.url;
    meta.captured_at = entry.captured_at || meta.captured_at;
    // 完整消息落文件
    const file = await this.readSessionFile(id);
    let messages = file.messages || [];
    const seen = new Set(messages.map(m => m.message_id).filter(Boolean));
    let added = 0;
    let tokens = 0;
    const newMessages = [];
    for (const m of entry.messages || []) {
      const norm = {
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
        ts: normalizeTs(m.ts),
        token_count: tokenCount(m),
        message_id: m.message_id || null
      };
      if (norm.message_id && seen.has(norm.message_id)) continue; // 幂等去重
      if (norm.message_id) seen.add(norm.message_id);
      messages.push(norm);
      newMessages.push(norm);
      added++;
      tokens += norm.token_count;
    }
    if (added > 0) {
      await this.writeSessionFile(id, {
        id, source: meta.source, url: meta.url, title: meta.title,
        captured_at: meta.captured_at, messages
      });
      meta.messages = messages.length;
      meta.token_count = (meta.token_count || 0) + tokens;
      await this.writeIndex(index);
      // 增量建索引：只索引本次新增的消息
      this.indexMessages(id, meta.title, newMessages);
    }
    return { id, added, total: messages.length };
  }

  async readSessionFile(id) {
    try {
      return JSON.parse(await readFile(sessionPath(this.root, id), "utf8"));
    } catch {
      return { id, messages: [] };
    }
  }

  async writeSessionFile(id, data) {
    await writeFile(sessionPath(this.root, id), JSON.stringify(data, null, 2), "utf8");
  }

  async list() {
    const index = await this.readIndex();
    return Object.values(index.sessions)
      .sort((a, b) => (b.captured_at || "").localeCompare(a.captured_at || ""));
  }

  async stats() {
    const list = await this.list();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let totalTokens = 0, todayTokens = 0, todayCaptured = 0;
    for (const s of list) {
      totalTokens += s.token_count || 0;
      if ((s.captured_at || "").startsWith(today)) {
        todayCaptured++;
        todayTokens += s.token_count || 0;
      }
    }
    return {
      totalTokens,
      conversations: list.length,
      todayCaptured,
      todayTokens,
      estUSD: Math.round((totalTokens / 1000) * USD_PER_1K_TOKENS * 100) / 100,
      pricePer1k: USD_PER_1K_TOKENS,
      tokenizer: "official-count-or-4chars-per-token"
    };
  }

  /** 删除捕获会话（文件 + 索引），并返回是否删掉了已导入标记。 */
  async remove(id) {
    const index = await this.readIndex();
    const existed = Boolean(index.sessions[id]);
    delete index.sessions[id];
    await this.writeIndex(index);
    await rm(sessionPath(this.root, id), { force: true });
    this.deindexSession(id);
    return existed;
  }

  async markImported(id) {
    const index = await this.readIndex();
    if (index.sessions[id]) {
      index.sessions[id].imported = true;
      await this.writeIndex(index);
    }
  }
}

/** 把 body 解析为 JSON；失败抛 400。 */
async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("invalid JSON body");
    err.status = 400;
    throw err;
  }
}

function respond(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // 供扩展跨源 POST（MV3 content script fetch 到 127.0.0.1 时浏览器会预检）
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-capture-token"
  });
  res.end(JSON.stringify(payload));
}

/**
 * 消息级导入：把选中的捕获消息按顺序写入新建的 Harness 会话。
 * 事件序列按「一轮问答」分组：每条 user 消息开一个 turn（turn/start →
 * user/message → assistant/message… → turn/end），多轮依次递增。
 * 通过 ctx.sessions.create + session.append + ctx.sessions.flush 持久化。
 */
async function importIntoSession(ctx, store, { id, indexes, sessionId: currentSessionId }) {
  if (!ctx.sessions) throw Object.assign(new Error("sessions service unavailable"), { status: 503 });
  const file = await store.readSessionFile(id);
  const all = file.messages || [];
  const sel = [...(indexes || [])].filter(i => Number.isInteger(i) && i >= 0 && i < all.length).sort((a, b) => a - b);
  if (sel.length === 0) throw Object.assign(new Error("no valid message indexes"), { status: 400 });
  const picked = sel.map(i => all[i]);

  // 解析当前会话的工作目录（工作区）：让导入的新会话落在「当前工作区」。
  // 否则新会话没有 cwd，会被持久化到 _no-cwd/，且不会出现在侧边栏会话列表。
  let cwd;
  if (currentSessionId) {
    try {
      cwd = ctx.sessions.get(currentSessionId)?.header?.cwd;
    } catch {
      // 当前会话不存在或非 live：忽略，下面按无 cwd 处理并告警
    }
  }
  if (!cwd && currentSessionId) {
    console.warn(`[dsh-deepseek-capture] current session ${currentSessionId} has no cwd — imported session may not appear in a workspace`);
  }

  // 合并连续同角色消息（与 ctxport 行为一致）：DeepSeek 对话可能产生连续
  // assistant 消息（如工具调用分段输出），Harness 会话里应合并为一条。
  const grouped = [];
  for (const m of picked) {
    const last = grouped[grouped.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`.trim();
      last.token_count = (last.token_count || 0) + (m.token_count || 0);
    } else {
      grouped.push({ ...m });
    }
  }

  // 用唯一会话 id（避免与 DSH 计数器生成的 session-N 冲突，也避免
  // 同一进程内多次导入时 id 撞车）
  const sessionId = `session-dsc-${randomUUID().slice(0, 8)}`;
  const session = ctx.sessions.create(sessionId, {
    meta: {
      source: "deepseek-capture",
      captureId: id,
      title: file.title || "DeepSeek 导入",
      ...(cwd ? { cwd } : {})
    }
  });

  // 按「一轮问答」分组：每条 user 消息开一个新 turn，紧随其后的 assistant
  // 消息归属该 turn（连续同角色已在上面合并，故一个 turn 内通常只有一条 assistant）。
  let turn = 0;
  let step = 0;
  let turnOpen = false;
  const closeTurn = () => {
    if (!turnOpen) return;
    session.append("turn/end", { turn, reason: { kind: "completed" } });
    turnOpen = false;
  };

  for (const m of grouped) {
    if (m.role !== "assistant") {
      closeTurn();
      turn++;
      step = 0;
      session.append("turn/start", { turn });
      turnOpen = true;
      session.append("user/message", {
        id: randomUUID(),
        role: "user",
        content: [{ type: "text", text: m.content }],
        source: { kind: "user" }
      }, { surfaceOp: "append" });
    } else {
      if (!turnOpen) {
        // 以 assistant 开头（无前置 user）：仍开一个 turn 承载
        turn++;
        step = 0;
        session.append("turn/start", { turn });
        turnOpen = true;
      }
      step++;
      session.append("assistant/message", {
        turn,
        step,
        message: {
          id: randomUUID(),
          role: "assistant",
          content: [{ type: "text", text: m.content }],
          source: { kind: "model", provider: "deepseek-official", model: "deepseek-web" }
        },
        usage: { inputTokens: 0, outputTokens: m.token_count || estimateTokens(m.content) }
      }, { surfaceOp: "append" });
    }
  }
  closeTurn();

  await ctx.sessions.flush(session);

  // 把新会话登记进当前工作区：仅设置 header.cwd 只会让会话落到正确的存储
  // 目录（--C-coding--），但不会把它加进工作区的会话列表；缺少这一步的话，
  // 侧边栏会把这个会话归到「未分组」而不是当前工作区。
  if (cwd) {
    try {
      const registry = ctx.get("workspaceRegistry");
      const workspace = registry ? await registry.resolveByPath(cwd) : void 0;
      if (workspace) {
        await workspace.attachSession(session.id);
      } else {
        console.warn(`[dsh-deepseek-capture] no workspace owns "${cwd}" — imported session may appear under 未分组`);
      }
    } catch (error) {
      console.warn(`[dsh-deepseek-capture] attach to workspace failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await store.markImported(id);
  return {
    sessionId: session.id,
    importedMessages: sel.length,
    messagesInSession: grouped.length,
    totalTokens: grouped.reduce((a, m) => a + (m.token_count || 0), 0),
    title: file.title || "DeepSeek 导入"
  };
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const root = captureDir(process.env);
  const store = new CaptureStore(root);
  // 惰性初始化：首次请求时确保目录/索引存在（不依赖 ready 时序，也便于测试）
  let initPromise = null;
  const ensureInit = () => (initPromise ??= store.init());

  ctx.on("ready", () => { void ensureInit(); });

  // ── 捕获接收 / 资产查询 / 统计 / 导入 路由（webServer 为可选服务：
  //    headless 等无 Web 组合也能加载插件，仅注册命令/skill）──
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.webServer.register({
      kind: "prefix",
      path: "/capture",
      handler: async (req, res) => {
        try {
          await ensureInit();
          const url = new URL(req.url ?? "/", "http://x");
          const path = url.pathname.replace(/\/+$/, "") || "/capture";
          const method = req.method ?? "GET";

          // CORS 预检
          if (method === "OPTIONS") {
            res.writeHead(204, {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET, POST, OPTIONS",
              "access-control-allow-headers": "content-type, x-capture-token"
            });
            res.end();
            return;
          }

          if (method === "POST" && (path === "/capture/ingest" || path === "/capture")) {
            const body = await readJsonBody(req);
            if (!Array.isArray(body.messages)) {
              respond(res, 400, { ok: false, error: "body.messages must be an array" });
              return;
            }
            const result = await store.upsert(body);
            respond(res, 200, { ok: true, ...result });
            return;
          }

          if (method === "GET" && path === "/capture/stats") {
            respond(res, 200, { ok: true, stats: await store.stats() });
            return;
          }

          if (method === "GET" && path === "/capture/sessions") {
            respond(res, 200, { ok: true, sessions: await store.list() });
            return;
          }

          if (method === "GET" && path === "/capture/messages") {
            const id = url.searchParams.get("id");
            if (!id) { respond(res, 400, { ok: false, error: "missing id" }); return; }
            const file = await store.readSessionFile(id);
            respond(res, 200, { ok: true, session: file });
            return;
          }

          if (method === "POST" && path === "/capture/import") {
            const body = await readJsonBody(req);
            const result = await importIntoSession(ctx, store, body);
            respond(res, 200, { ok: true, ...result });
            return;
          }

          if (method === "GET" && path === "/capture/search") {
            const q = url.searchParams.get("q") || "";
            const limit = Number(url.searchParams.get("limit")) || 20;
            const hits = await store.search(q, limit);
            respond(res, 200, { ok: true, hits });
            return;
          }

          if (method === "DELETE" && path === "/capture/sessions") {
            const id = url.searchParams.get("id");
            if (!id) { respond(res, 400, { ok: false, error: "missing id" }); return; }
            const existed = await store.remove(id);
            respond(res, 200, { ok: true, removed: existed });
            return;
          }

          respond(res, 404, { ok: false, error: `no route: ${method} ${path}` });
        } catch (error) {
          const status = error && error.status ? error.status : 500;
          respond(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    });
  });

  // ── /capture 人类命令：统计概览 ──
  ctx.commands.register({
    name: CMD_NAME,
    description: "查看 DeepSeek 对话捕获统计与资产概览",
    handler: async () => {
      await ensureInit();
      const s = await store.stats();
      const list = await store.list();
      const recent = list.slice(0, 5).map(x =>
        `- ${x.title}（${x.messages} 条 · ${x.token_count} tk · ${x.imported ? "已导入" : "未导入"}）`
      ).join("\n");
      return {
        kind: "success",
        text: [
          `📊 DeepSeek 捕获统计（本地存储 ${root}）`,
          `累计 Token：${s.totalTokens.toLocaleString()}（官方计数/估算口径）`,
          `累计对话：${s.conversations} 段 · 今日捕获：${s.todayCaptured} 段（${s.todayTokens.toLocaleString()} tk）`,
          `估算节省：~$${s.estUSD}（按 $${s.pricePer1k}/1k tokens）`,
          "",
          "最近捕获：",
          recent || "（暂无）",
          "",
          "在侧边栏「DeepSeek 捕获」面板可按消息挑选并导入到当前工作区新建会话。"
        ].join("\n")
      };
    }
  });

  // ── skill：让模型知道如何访问捕获资产 ──
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN_TO_USE,
    content: SKILL_CONTENT,
    source: "runtime",
    metadata: { version: "0.1.1", source: "dsh-deepseek-capture" }
  });
}

/** 所需服务：命令注册 + 技能注册 + 会话服务（webServer 为可选，见 apply 内 ctx.inject）。 */
export const inject = ["commands", "skills", "sessions"];

// ── 导出（供测试/复用） ──
export { CaptureStore, estimateTokens, tokenCount, normalizeTs, captureDir, importIntoSession };

