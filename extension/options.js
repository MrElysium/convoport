// options 逻辑：保存后端地址
const input = document.getElementById("backend");
const ok = document.getElementById("ok");

chrome.storage.sync.get("backendUrl").then(({ backendUrl }) => {
  input.value = backendUrl || "http://127.0.0.1:3080";
});

document.getElementById("save").addEventListener("click", async () => {
  let url = input.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) url = "http://" + url;
  await chrome.storage.sync.set({ backendUrl: url });
  ok.textContent = "已保存 ✓";
  setTimeout(() => { ok.textContent = ""; }, 2000);
});
