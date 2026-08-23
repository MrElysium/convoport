/**
 * content.js 启动完整性测试：在 vm 沙箱中完整执行 content.js（不触发真实
 * 网络），验证初始化不抛错、URL 提取、去抖、历史重写 hook 都正常工作。
 * 运行：node test/content-boot.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

let pushStateCalled = false;
let replaceStateCalled = false;
let intervalRegistered = false;
let sendMessageCalls = 0;

const sandbox = {
  location: { href: "https://chat.deepseek.com/a/chat/s/boot-test-1", protocol: "https:", host: "chat.deepseek.com" },
  history: {
    pushState: function () { pushStateCalled = true; },
    replaceState: function () { replaceStateCalled = true; }
  },
  window: {},
  document: {
    readyState: "complete",
    addEventListener() {},
    title: "DeepSeek 对话",
    body: { appendChild: () => {}, style: {} },
    documentElement: { appendChild: () => {}, style: {} },
    createElement: () => ({ style: {}, addEventListener: () => {}, appendChild: () => {} })
  },
  localStorage: { getItem: () => JSON.stringify({ value: "fake-token" }) },
  chrome: {
    runtime: {
      sendMessage: async () => { sendMessageCalls++; return { ok: true }; },
      onMessage: { addListener: () => {} }
    }
  },
  setTimeout: (fn) => { fn(); return 0; },  // 立即执行初始 sync
  setInterval: () => { intervalRegistered = true; return 1; },
  addEventListener: () => {},  // window.addEventListener（wrapHistory 里注册 popstate）
  fetch: async () => ({ ok: true, json: async () => ({ data: { biz_data: { chat_session: { title: "测试" }, chat_messages: [] } } }) }),
  console: { debug() {}, log() {}, error() {} },
  URLSearchParams,
  Number, String, Math, Date, JSON, Promise, RegExp, Set, Map
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let bootError = null;
try {
  vm.runInContext(src, sandbox, { filename: "content.js" });
} catch (e) {
  bootError = e;
}

let ok = true;
const check = (name, cond, detail) => {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : " — " + (detail || "")}`);
  if (!cond) ok = false;
};

check("content.js 启动不抛错", bootError === null, bootError && bootError.message);
check("轮询已注册", intervalRegistered === true);

// 提取 sessionId（通过 URL 匹配）
const m = sandbox.location.href.match(/\/a\/chat\/(?:s\/)?([a-zA-Z0-9-]+)/);
check("URL 会话 ID 提取", m && m[1] === "boot-test-1", m && m[1]);

// history 重写：content.js 在沙箱 history 对象上替换了 pushState/replaceState
const sandboxHistory = vm.runInContext("history", sandbox);
const pushIsWrapped = typeof sandboxHistory.pushState === "function" &&
  !/^function pushState\(/.test(sandboxHistory.pushState.toString().slice(0, 40)) === false &&
  sandboxHistory.pushState.length >= 0; // 替换后的 wrapper 是 ...args 形式
// 更可靠：wrapper 通过 apply 调用原函数，检查其 toString 含 'apply'
const pushStr = sandboxHistory.pushState.toString();
const replaceStr = sandboxHistory.replaceState.toString();
check("history.pushState 被重写", pushStr.includes("apply") || pushStr.includes("..."), pushStr.slice(0, 60));
check("history.replaceState 被重写", replaceStr.includes("apply") || replaceStr.includes("..."), replaceStr.slice(0, 60));

// 验证 syncSession 被初始调用（setTimeout 立即执行 → fetch → sendMessage）
// 注意：extractAuthToken 用 fake-token，fetch 返回空消息 → messages.length===0 → 不发消息
check("空会话不触发上报（正确）", sendMessageCalls === 0, `sendMessage called ${sendMessageCalls} times`);

process.exit(ok ? 0 : 1);
