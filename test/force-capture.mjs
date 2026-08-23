/**
 * 一键捕获（force）逻辑验证：
 * 1. 源码包含 force 参数、CAPTURE_NOW 监听、注入按钮、按钮点击 force 调用
 * 2. 去抖语义：非 force 在 5 秒内重复调用被拦截；force 无视去抖
 * 3. popup 的 CAPTURE_NOW 触发路径存在（tabs.sendMessage）
 * 运行：node test/force-capture.mjs
 */
import { readFileSync } from "node:fs";

const contentSrc = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const popupSrc = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

let ok = true;
const check = (n, c, d) => { console.log(`${c ? "✅" : "❌"} ${n}${c ? "" : " — " + (d || "")}`); if (!c) ok = false; };

// 1. 源码结构
check("syncSession 带 force 参数", /async function syncSession\(force\)/.test(contentSrc));
check("CAPTURE_NOW 消息监听", /CAPTURE_NOW/.test(contentSrc) && /syncSession\(true\)/.test(contentSrc));
check("注入浮动按钮", /injectCaptureButton/.test(contentSrc) && /dsc-capture-btn/.test(contentSrc));
check("按钮点击强制捕获", /btn\.addEventListener\("click"/.test(contentSrc) && /syncSession\(true\)/.test(contentSrc));
check("按钮仅会话页显示", /extractSessionId\(location\.href\) \? "block" : "none"/.test(contentSrc));
check("非 force 去抖逻辑", /!force && lastSync\.id === sessionId/.test(contentSrc));

// 2. popup 触发路径
check("popup 有立即捕获按钮处理", /captureNow/.test(popupSrc));
check("popup 用 tabs.sendMessage 发 CAPTURE_NOW", /chrome\.tabs\.sendMessage\(tab\.id, \{ type: "CAPTURE_NOW" \}\)/.test(popupSrc));
check("manifest 有 tabs 权限", manifest.permissions && manifest.permissions.includes("tabs"));

// 3. 去抖语义纯逻辑验证（模拟 lastSync 状态更新）
const logic = new Function(`
const MIN_INTERVAL_MS = 5000;
let lastSync = { id: null, at: 0 };
function shouldSync(sessionId, now, force) {
  if (!sessionId) return false;
  if (!force && lastSync.id === sessionId && now - lastSync.at < MIN_INTERVAL_MS) return false;
  lastSync.id = sessionId;
  lastSync.at = now;
  return true;
}
return shouldSync;`)();
check("去抖：5 秒内非 force 拦截", logic("s1", 1000, false) === true && logic("s1", 3000, false) === false);
check("force：5 秒内仍通过", logic("s1", 4000, true) === true);
check("换会话：非 force 也通过", logic("s2", 4200, false) === true);

process.exit(ok ? 0 : 1);
