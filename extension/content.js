/**
 * Convoport — content script
 *
 * 在 chat.deepseek.com 页面运行：
 * 1. 监听 SPA 路由变化（history pushState/replaceState + popstate），
 *    识别会话页 URL（/a/chat/<id> 或 /a/chat/s/<id>）。
 * 2. 调 DeepSeek 官方 history_messages 接口拉取会话历史。
 * 3. 把消息转发给 background（发消息即触发上报）。
 *
 * 认证：localStorage.userToken 的 .value 字段（仅在页面上下文可读）。
 * 只读页面数据，绝不把 token 发给本地后端（后端只收对话内容）。
 */

const CONVERSATION_PATTERN = /^https?:\/\/chat\.deepseek\.com\/a\/chat\/(?:s\/)?([a-zA-Z0-9-]+)/;
const API_BASE = "https://chat.deepseek.com/api/v0";

/** 上报去抖：同一会话短时间内不重复拉取。 */
let lastSync = { id: null, at: 0 };
const MIN_INTERVAL_MS = 5000;

function extractSessionId(url) {
  const m = CONVERSATION_PATTERN.exec(url || location.href);
  return m ? m[1] : null;
}

function extractAuthToken() {
  try {
    const stored = localStorage.getItem("userToken");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return String(parsed.value);
    }
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchHistory(sessionId, token) {
  const res = await fetch(
    `${API_BASE}/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "x-app-version": "20241129.1",
        "x-client-locale": "en_US",
        "x-client-platform": "web"
      },
      credentials: "include"
    }
  );
  if (!res.ok) throw new Error(`DeepSeek API responded with ${res.status}`);
  return res.json();
}

/** 解析为上报格式：role/content/ts/token_count/message_id。
 *  token_count = 本条消息 accumulated_token_count 与上一条的差值（官方累计值）。 */
function parseConversation(data, url) {
  const messages = data?.data?.biz_data?.chat_messages ?? [];
  const title = data?.data?.biz_data?.chat_session?.title;
  const sorted = [...messages].sort((a, b) => (a.message_id ?? 0) - (b.message_id ?? 0));
  const out = [];
  let prevAccumulated = 0;
  for (const m of sorted) {
    const role = String(m.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = String(m.content ?? "").trim();
    if (!text) continue;
    const accumulated = Number(m.accumulated_token_count) || 0;
    // 差值 = 本条累计值 - 上一条累计值；仅在累计值有效（>0）时推进基准，
    // 避免某条缺字段时把基准清零导致后续差值虚高。
    let delta = 0;
    if (accumulated > 0) {
      delta = Math.max(0, accumulated - prevAccumulated);
      prevAccumulated = accumulated;
    }
    out.push({
      role,
      content: text,
      ts: m.inserted_at || new Date().toISOString(),
      token_count: delta,
      message_id: m.message_id ?? null
    });
  }
  return { title, messages: out };
}

async function syncSession(force) {
  const sessionId = extractSessionId(location.href);
  if (!sessionId) return { ok: false, reason: "no-session" };
  const now = Date.now();
  // 非强制时去抖；force（一键捕获）时无视去抖立即拉取
  if (!force && lastSync.id === sessionId && now - lastSync.at < MIN_INTERVAL_MS) return { ok: true, reason: "throttled" };
  const token = extractAuthToken();
  if (!token) return { ok: false, reason: "no-token" };

  lastSync.id = sessionId;
  lastSync.at = now;
  try {
    const data = await fetchHistory(sessionId, token);
    const { title, messages } = parseConversation(data, location.href);
    if (messages.length === 0) return { ok: true, reason: "empty" };
    await chrome.runtime.sendMessage({
      type: "CAPTURE_CONVERSATION",
      payload: {
        source: "deepseek",
        url: location.href.split("?")[0],
        title: title || document.title || "未命名对话",
        captured_at: new Date().toISOString(),
        messages
      }
    });
    return { ok: true, reason: "synced", count: messages.length };
  } catch (e) {
    console.debug("[convoport] sync failed:", e && e.message);
    return { ok: false, reason: "error", error: e && e.message };
  }
}

// SPA 路由感知：只包装一次 history 方法，路由变化后统一触发所有注册的回调
// （避免多处各自 monkey-patch pushState/replaceState 造成重复包装）。
const routeChangeCallbacks = new Set();

/** 注册一个路由变化回调（pushState/replaceState/popstate 时触发）。 */
function onRouteChange(fn) {
  routeChangeCallbacks.add(fn);
}

function installHistoryWatchers() {
  const notify = () => {
    for (const fn of routeChangeCallbacks) setTimeout(fn, 300);
  };
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (...args) {
    const r = push.apply(this, args);
    notify();
    return r;
  };
  history.replaceState = function (...args) {
    const r = replace.apply(this, args);
    notify();
    return r;
  };
  window.addEventListener("popstate", notify);
}

// 页面右下角浮动按钮：一键捕获当前对话（绕过轮询等待，立即拉取并上报）
function injectCaptureButton() {
  const btn = document.createElement("button");
  btn.id = "dsc-capture-btn";
  btn.textContent = "⛁ 捕获本对话";
  Object.assign(btn.style, {
    position: "fixed",
    right: "18px",
    bottom: "90px",
    zIndex: "2147483000",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#fff",
    background: "linear-gradient(135deg,#4d6bfe,#7a5cff)",
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(77,107,254,.45)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "none"
  });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "⛁ 捕获中…";
    const result = await syncSession(true);
    btn.textContent = result && result.ok
      ? `✅ 已捕获 ${result.count || ""} 条`.trim()
      : "⚠ 捕获失败，稍后再试";
    btn.disabled = false;
    setTimeout(() => { btn.textContent = original; }, 2500);
  });
  (document.body || document.documentElement).appendChild(btn);

  // 只在会话页显示按钮（非会话页隐藏）；路由变化统一由 installHistoryWatchers 触发
  const updateVisibility = () => {
    btn.style.display = extractSessionId(location.href) ? "block" : "none";
  };
  updateVisibility();
  onRouteChange(updateVisibility);
}

// 页面初次加载 + 轻量轮询兜底（增量消息自动补齐；页面不可见时暂停省资源）
function start() {
  onRouteChange(() => syncSession());
  installHistoryWatchers();
  injectCaptureButton();
  setTimeout(syncSession, 800);

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (extractSessionId(location.href)) syncSession();
  }, 15000);
}

// 支持扩展 popup「立即捕获」：消息触发强制同步
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CAPTURE_NOW") {
    syncSession(true).then((result) => sendResponse(result || { ok: false, reason: "unknown" }));
    return true; // 异步 sendResponse
  }
  return false;
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
