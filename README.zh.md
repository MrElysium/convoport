# dsh-deepseek-capture

**DeepSeek Harness 插件：全自动捕获 DeepSeek 网页版对话，100% 本地存储，按消息挑选导入工作区会话，并统计你节省的 Token。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md)

## 它做什么

| 能力 | 说明 |
|---|---|
| **自动捕获** | 配套浏览器扩展（MV3）监听 `chat.deepseek.com`，通过官方 `history_messages` 接口拉取对话，自动同步到本插件 |
| **本地存储** | 数据落在 `$DSH_HOME/capture/`（JSON，每会话一个文件 + `index.json`），**零上传**，开发者可直接查看 |
| **Token 统计** | 累计节省 Token / 对话数 / 今日捕获 / 估算金额（页面标注口径） |
| **消息级导入** | 不整段导入——打开捕获对话，**按单条消息勾选**（快捷"仅开头/仅结尾"），导入 = 在当前工作区**新建 Harness 会话**，选中消息成为该会话历史，可继续对话 |

## 架构

```
浏览器扩展 (MV3)                    dsh 插件 (本仓库)
┌──────────────────────┐   POST   ┌──────────────────────────────┐
│ content script       │ ────────▶ │ lib/index.js  服务端半区      │
│ · chat.deepseek.com  │ /capture │ · /capture/ingest   接收落盘   │
│ · 官方 API 拉取      │          │ · /capture/sessions 资产列表   │
│ · 批量队列上报       │          │ · /capture/messages 消息详情   │
└──────────────────────┘          │ · /capture/stats    统计      │
                                  │ · /capture/import   导入新会话 │
                                  │ lib/client.js  Web 侧边栏面板  │
                                  │   sidebar.footer.action 槽位   │
                                  └──────────────────────────────┘
```

## 安装

```bash
# 1. 安装插件（npm 发布后；本地开发用 dsh-md-quiz 同款 link 方式）
dsh plugin --profile web add dsh-deepseek-capture
# 重启 dsh web，刷新浏览器

# 2. 加载浏览器扩展（extension/ 目录随 npm 包发布，也可从 GitHub 仓库获取）
#    位置：node_modules/dsh-deepseek-capture/extension/ 或仓库 extension/ 目录
#    chrome://extensions → 打开「开发者模式」→ 「加载已解压的扩展程序」→ 选择 extension/ 目录
#    可选：点击扩展图标 → 设置 → 确认后端地址为 http://127.0.0.1:3080（dsh web 端口）
```

> 提示：安装插件后扩展目录在 `node_modules/dsh-deepseek-capture/extension/`；
> 也可以直接从 GitHub 仓库（`extension/`）加载，两者内容一致。

## 用法

1. 浏览器扩展开启后，在 `chat.deepseek.com` 正常对话，扩展自动同步。
2. Web 侧边栏底部出现「⛁ DeepSeek 捕获」按钮 → 打开面板：
   - 统计卡：累计 Token / 对话数 / 今日捕获 / 估算金额
   - 捕获列表：每段对话的标题、条数、Token、导入状态
3. 点某段对话 → **消息级选择视图**：勾选需要的消息（快捷"仅开头 3 条 / 仅结尾 3 条 / 全选 / 清空"）
4. 点「导入选中到新会话 (N)」→ 左侧会话列表出现新会话，历史就是选中的 DeepSeek 消息，可继续对话。

也支持 `/capture` 命令在对话里直接看统计概览。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/capture/ingest` | 扩展上报对话 `{source,url,title,captured_at,messages[]}`；按 url 幂等合并，按 message_id 去重 |
| GET | `/capture/sessions` | 捕获资产列表（含导入状态） |
| GET | `/capture/messages?id=` | 某会话完整消息 |
| GET | `/capture/stats` | 统计 |
| GET | `/capture/search?q=` | 全文搜索（SQLite FTS5 + LIKE 兜底） |
| POST | `/capture/import` | `{id, indexes[]}` → 新建 Harness 会话，返回 `sessionId` |
| DELETE | `/capture/sessions?id=` | 删除捕获会话 |

## Token 口径

- 优先使用 DeepSeek 官方 `accumulated_token_count`（扩展上报时写入每条消息的 `token_count`）
- 缺省时用 Harness 同款启发式：4 字符/token + 结构开销（与 `dsh-token-meter` 一致）
- 统计页/命令输出均标注口径；估算金额按 `$0.02 / 1k tokens` 参考价

## 开发

```bash
# 本地 link 安装（照 dsh-md-quiz）：
cd E:\项目\dsh-deepseek-capture
# 在 profile 的 package.json dependencies 加 "dsh-deepseek-capture": "link:E:/项目/dsh-deepseek-capture"
# 然后 dsh plugin --profile web add dsh-deepseek-capture 触发 reconcile
```

服务端（lib/index.js）改动需重启 `dsh web`；客户端（lib/client.js）是 no-cache 实时读盘，改完刷新浏览器即可。

### 测试

```bash
node test/standalone.mjs       # 存储层：幂等 upsert / 去重 / 统计
node test/session-events.mjs   # 会话事件序列被 dsh-session 接受并正确回放
node test/integration.mjs      # live 模式 create + append + flush
node test/edge-cases.mjs       # 边界：连续 assistant / 连续 user 消息
node test/content-logic.mjs    # 扩展 content.js 解析逻辑（token 差值/排序/过滤）
node test/content-boot.mjs     # 扩展 content.js 启动完整性（hook 重写/初始化）
node test/background-queue.mjs # 扩展 background 队列（合并/去重/持久化）
node test/http-e2e.mjs         # HTTP 全链路：ingest → stats → search → import
node test/extension-e2e.mjs    # 扩展→插件全链路（需先起 dsh web）
```
