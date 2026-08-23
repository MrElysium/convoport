# dsh-deepseek-capture — 项目介绍

> **DeepSeek Harness 生态插件：全自动捕获 DeepSeek 网页版对话，100% 本地存储，按消息挑选导入工作区会话，并统计你节省的 Token。**

---

## 一、项目定位（一句话）

**把你的 DeepSeek 网页对话变成属于你的本地资产**——浏览器扩展自动捕获 `chat.deepseek.com` 的对话，本地插件负责存储、统计和按需导入，让"对话记录 + Token 节省"可视化，且**零数据上传**。

## 二、解决的痛点

| 痛点 | 本项目方案 |
|---|---|
| DeepSeek 对话记录在云端，无法本地留存 | 扩展自动拉取对话，100% 落本地 `$DSH_HOME/capture/`（纯 JSON，开发者可读） |
| 想复用对话上下文，但复制粘贴丢格式 | 按**单条消息**挑选导入 → 新建 Harness 会话，历史就是选中的消息，可继续对话 |
| 打磨过程（中间反复试错）占对话大头 | 快捷"仅开头 3 条 / 仅结尾 3 条"，跳过价值低的打磨过程 |
| 不知道自己为 AI 对话花了多少 Token | 统计页实时展示累计节省 Token / 对话数 / 今日捕获 / 估算金额（口径标注） |

## 三、架构

```
浏览器扩展 (MV3)                    dsh 插件（本仓库）
┌──────────────────────┐   POST   ┌──────────────────────────────┐
│ content script       │ ────────▶ │ lib/index.js  服务端半区      │
│ · chat.deepseek.com  │ /capture │ · /capture/ingest   接收落盘   │
│ · 官方 API 拉取      │          │ · /capture/sessions 资产列表   │
│ · 批量队列上报       │          │ · /capture/messages 消息详情   │
│ · 一键捕获按钮       │          │ · /capture/stats    统计      │
└──────────────────────┘          │ · /capture/search   全文搜索  │
                                  │ · /capture/import   导入新会话 │
                                  │ lib/client.js  Web 捕获页 tab  │
                                  │   conversation.view 轨迹旁     │
                                  └──────────────────────────────┘
```

- **扩展**（`extension/`）：MV3，content script 调 DeepSeek 官方 `history_messages` 接口（不是抓 DOM），批量队列上报 + 幂等去重 + 一键捕获按钮
- **插件服务端**（`lib/index.js`）：`/capture/*` 路由 + JSON 存储 + SQLite FTS5 搜索 + 消息级导入（`ctx.sessions` 新建会话）
- **插件客户端**（`lib/client.js`）：对话区「⛁ DeepSeek 捕获」tab（`conversation.view` 槽位，位于轨迹旁），中英双语

## 四、核心功能

1. **自动捕获**：进入对话页自动同步，路由变化 + 15s 轮询增量补齐；页面右下角「⛁ 捕获本对话」一键强制同步；popup「立即捕获当前对话」
2. **本地存储**：`$DSH_HOME/capture/sessions/<id>.json`（每会话一文件）+ `index.json`；`message_id` 幂等去重，同 url 合并
3. **Token 统计**：优先 DeepSeek 官方 `accumulated_token_count`，缺省用 Harness 同款 4 字符/token 启发式；估算金额按 `$0.02/1k tokens` 参考价，页面标注口径
4. **全文搜索**：SQLite FTS5 + LIKE 兜底（中文子串召回），`/capture/search?q=`
5. **消息级导入**：勾选单条消息（快捷首尾/全选/清空）→ 在当前工作区**新建 Harness 会话**，选中消息成为历史；连续同角色消息自动合并（与 ctxport 行为一致）
6. **会话落盘**：导入的新会话写入 `$DSH_HOME/sessions/`（Harness 标准 `session-dsc-*` 目录），可被 Harness 正常消费

## 五、技术要点

| 项 | 选型 |
|---|---|
| 插件框架 | Cordis 4（DSH profile bundle 机制），`ctx.inject` 可选依赖（webServer 在 headless 下优雅降级） |
| 存储 | JSON 双写（权威）+ `node:sqlite` FTS5 索引（Node 22.5+，自动降级 LIKE） |
| 捕获 | DeepSeek 官方 `GET /api/v0/chat/history_messages` + `localStorage.userToken` 认证 |
| Token | 官方 `accumulated_token_count` 差值 > Harness 启发式兜底 |
| 会话导入 | `ctx.sessions.create` + `session.append`（turn/start → messages → turn/end）+ `flush` |
| 扩展 | MV3 + content script + background 批量队列（storage 持久化防丢）+ `_locales` 双语 |
| 安装 | `dsh plugin --profile web add dsh-deepseek-capture`（npm 包含扩展，18 文件） |

## 六、验证情况（11 套测试全过）

| 测试 | 覆盖 |
|---|---|
| `standalone` | 存储幂等 upsert / message_id 去重 / 统计 |
| `session-events` | 会话事件序列被真实 `dsh-session` 接受并正确回放 |
| `integration` | live 模式 create + append + flush + 持久化 listener |
| `edge-cases` | 连续 assistant / 连续 user 消息边界 |
| `content-logic` / `content-boot` | 扩展解析逻辑（token 差值/排序/过滤）+ 启动完整性 |
| `background-queue` | 扩展队列合并 / 去重 / 持久化 |
| `force-capture` | 一键捕获 force 语义 / 去抖 / 按钮注入 / popup 路径 |
| `http-e2e` | HTTP 全链路（ingest → stats → search → import）+ headless 兼容 |
| `extension-e2e` | 扩展→插件全链路（真实 dsh web） |
| `final-run` | 真实 dsh web 端到端 8 步全通 |

**真实环境验证**：真实 `dsh web`（0.1.0-rc.7）多轮端到端；隔离 DSH_HOME + 全新 profile 干净安装（tarball → reconcile → 全功能）；headless profile 兼容（无 webServer 不破坏启动）。

## 七、开发历程（12 个提交）

1. **方案定稿**（原型验证）：3 个 UI 变体 → 用户确认「方案 C：仪表盘 + 消息级选择导入」→ 拆分为独立原型 + 归档 A/B
2. **v0.1.0**：插件骨架 + 存储 + API + 导入会话 + Web 面板（`83e87f9`）
3. **质量加固**：扩展队列丢数据 bug、token 差值 bug、会话 id 冲突（真实环境抓出）、连续消息合并、SQLite 搜索（`88a7175` 等）
4. **发布准备**：`ctx.inject` 可选 webServer（headless 兼容）、npm 包含扩展、双语 README、Chrome 商店 i18n（`36fbb08`/`402424b`）
5. **体验迭代**：一键捕获按钮（页面浮动按钮 + popup 动作）、捕获页放对话区 tab（`9f8a2a8`/`adb8e22`）、移除侧边栏弹窗（`154c884`）
6. **安全**：清除误入历史的 `extension.pem` 私钥（`gitignore *.pem`）

## 八、开源与发布

- **协议**：MIT
- **发布**：npm 包 `dsh-deepseek-capture`（`dsh plugin add` 安装）；GitHub `dsh-plugin` 话题收录（待建仓）
- **文档**：README（英文主版）/ README.zh.md / PUBLISH.md / 本介绍
- **扩展**：随 npm 包发布（`node_modules/dsh-deepseek-capture/extension/`），手动加载或后续提交 Chrome 商店

## 九、Roadmap

- [x] 插件骨架 + 存储 + API + 导入会话 + Web 捕获页
- [x] 浏览器扩展（官方 API 捕获 + 批量上报 + 一键捕获）
- [x] SQLite 全文搜索 / 消息合并 / 面板搜索 / i18n 双语
- [x] Web + headless 双组合兼容 / 干净安装验证 / 真实 dsh web 端到端
- [ ] npm 发布 + `dsh-plugin` 话题收录
- [ ] Chrome 商店提交
- [ ] 真实 DeepSeek 账号浏览器实测
