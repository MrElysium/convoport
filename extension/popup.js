// popup logic: show recent sync status, allow manual retry (i18n via chrome.i18n)
const dot = document.getElementById("dot");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

// Apply static labels from _locales (elements carry data-i18n attributes)
document.querySelectorAll("[data-i18n]").forEach((el) => {
  const msg = i18n(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

// Backend hint is locale-aware; fall back to the URL if not localized.
const backendHint = i18n("backendHint") || "Local backend defaults to http://127.0.0.1:3080 (dsh web port)";

async function refresh() {
  const { lastSync, backendUrl } = await chrome.storage.local.get(["lastSync", "backendUrl"]);
  const backend = backendUrl || "http://127.0.0.1:3080";
  if (!lastSync) {
    dot.className = "dot unknown";
    statusEl.textContent = i18n("statusNeverSynced") || "Not synced yet";
    metaEl.textContent = backendHint;
    return;
  }
  if (lastSync.ok) {
    dot.className = "dot on";
    statusEl.textContent = i18n("statusSynced", [String(lastSync.count)]) || `Synced ${lastSync.count} conversation(s)`;
    metaEl.textContent = `${i18n("lastSync") || "Last sync"}: ${new Date(lastSync.at).toLocaleTimeString()}\n${i18n("backend") || "Backend"}: ${backend}`;
  } else {
    dot.className = "dot off";
    statusEl.textContent = i18n("statusFailed", [lastSync.error || "unknown"]) || `Sync failed (${lastSync.error || "unknown"})`;
    metaEl.textContent = `${i18n("backend") || "Backend"}: ${backend}${lastSync.retryIn ? `\n${i18n("retryIn", [String(Math.round(lastSync.retryIn / 1000))]) || `Retry in ${Math.round(lastSync.retryIn / 1000)}s`}` : ""}`;
  }
}

document.getElementById("captureNow").addEventListener("click", async () => {
  const el = document.getElementById("captureNow");
  el.textContent = "⛁ 捕获中…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/chat\.deepseek\.com/.test(tab.url || "")) {
      el.textContent = "⚠ 请先打开 chat.deepseek.com 对话页";
      setTimeout(() => { el.textContent = "⛁ 立即捕获当前对话"; }, 2500);
      return;
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_NOW" });
    el.textContent = res && res.ok
      ? `✅ 已捕获 ${res.count || ""} 条`.trim()
      : "⚠ 捕获失败（未登录或不在会话页）";
  } catch (e) {
    el.textContent = "⚠ 页面未注入，请刷新 DeepSeek 页";
  }
  setTimeout(() => { el.textContent = "⛁ 立即捕获当前对话"; }, 2500);
});

document.getElementById("retry").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CAPTURE_RETRY" });
  statusEl.textContent = i18n("retrying") || "Retrying…";
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastSync) refresh();
});
