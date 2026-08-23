/**
 * Convoport — background service worker
 *
 * 接收 content script 发来的捕获消息，批量队列上报到本地
 * DeepSeek Harness 插件的 /capture/ingest 端点（默认 http://127.0.0.1:3080）。
 *
 * 策略：
 * - 同一会话（url）的多次上报合并成一条（消息按 message_id 去重，服务端幂等）；
 * - 不同会话逐个 POST（服务端按 url 合并）；
 * - 队列持久化到 chrome.storage.local，service worker 重启不丢；
 * - 失败指数退避重试，超过上限丢弃并记录。
 */

const DEFAULT_BACKEND = "http://127.0.0.1:3080";
const FLUSH_INTERVAL_MS = 2000;
const MAX_RETRIES = 8;
const QUEUE_KEY = "captureQueue";

let retryCount = 0;
let flushTimer = null;
let flushing = false;

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  return backendUrl || DEFAULT_BACKEND;
}

/** 读持久化队列（内存缓存 + storage 双保险）。 */
let memQueue = null;
async function loadQueue() {
  if (memQueue !== null) return memQueue;
  const { [QUEUE_KEY]: q } = await chrome.storage.local.get(QUEUE_KEY);
  memQueue = Array.isArray(q) ? q : [];
  return memQueue;
}
async function saveQueue() {
  if (memQueue === null) return;
  await chrome.storage.local.set({ [QUEUE_KEY]: memQueue });
}

function enqueue(payload) {
  // 与队列中同 url 的条目合并（取最新 title/captured_at，消息追加）
  const existing = memQueue.find((p) => p.url && p.url === payload.url);
  if (existing) {
    existing.title = payload.title || existing.title;
    existing.captured_at = payload.captured_at || existing.captured_at;
    const seen = new Set((existing.messages || []).map((m) => m.message_id).filter((x) => x != null));
    for (const m of payload.messages || []) {
      if (m.message_id != null && seen.has(m.message_id)) continue;
      if (m.message_id != null) seen.add(m.message_id);
      existing.messages.push(m);
    }
  } else {
    memQueue.push(payload);
  }
  void saveQueue();
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  flushTimer = null;
  if (flushing) return;
  if (memQueue.length === 0) return;

  flushing = true;
  try {
    const backend = await getBackendUrl();
    const failed = [];
    for (const payload of memQueue) {
      try {
        const res = await fetch(`${backend}/capture/ingest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        failed.push(payload);
      }
    }
    memQueue = failed;
    await saveQueue();

    if (failed.length === 0) {
      retryCount = 0;
      await chrome.storage.local.set({
        lastSync: { at: Date.now(), ok: true, count: memQueue.length }
      });
    } else {
      retryCount++;
      const delay = Math.min(30000, 1000 * 2 ** retryCount);
      await chrome.storage.local.set({
        lastSync: { at: Date.now(), ok: false, error: `failed ${failed.length} item(s)`, retryIn: delay }
      });
      if (retryCount < MAX_RETRIES) {
        flushTimer = setTimeout(flush, delay);
      } else {
        // 超出重试上限：丢弃并记录，避免无限积压
        memQueue = [];
        await saveQueue();
        await chrome.storage.local.set({
          lastSync: { at: Date.now(), ok: false, error: `dropped after ${MAX_RETRIES} retries` }
        });
        retryCount = 0;
      }
    }
  } finally {
    flushing = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CAPTURE_CONVERSATION") {
    void loadQueue().then(() => {
      enqueue(msg.payload);
      sendResponse({ ok: true });
    });
    return true; // 异步 sendResponse
  }
  if (msg && msg.type === "CAPTURE_RETRY") {
    void loadQueue().then(() => {
      retryCount = 0;
      setTimeout(flush, 0);
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

// 启动时恢复队列
void loadQueue();
chrome.runtime.onStartup.addListener(() => {
  void loadQueue().then(() => {
    if (memQueue.length > 0) setTimeout(flush, 500);
  });
});
chrome.runtime.onInstalled.addListener(() => {
  void loadQueue();
});
