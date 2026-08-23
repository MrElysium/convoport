# 发布 dsh-deepseek-capture 到 DeepSeek Harness 生态

本文档说明如何把这个插件发布成 DSH 生态里可被 `dsh plugin add` 安装、可被
`dsh-plugin` GitHub 话题收录的正式插件。

## 1. 发布前准备（已就绪的部分）

本仓库已经按要求配好：

- `package.json`
  - `dsh.bundle.patch = "./cordis.patch.yml"` → `dsh plugin add` 会自动把它注册进 profile 的 `bundles`
  - `dsh.client = { platform: "web", inject: [...], immediately: true }` → 客户端半区被扫进 `window.__DSH_BOOT__`
  - `exports` 暴露 `.`（服务端）/ `./client`（客户端）/ `./cordis.patch.yml` / `./package.json`
  - `files` 打包 `lib`、`extension`、`cordis.patch.yml`、`README.md`、`PUBLISH.md`、`LICENSE`
- `cordis.patch.yml`：插入了 `deepseek-capture` 插件行
- `lib/index.js`（服务端：/capture 路由 + /capture 命令 + skill）、`lib/client.js`（客户端：侧边栏面板）、`lib/types/index.d.ts`、`LICENSE`
- `extension/`：浏览器扩展（MV3，**随 npm 包一起发布**；用户可从 `node_modules/dsh-deepseek-capture/extension/` 加载，也可从 GitHub 获取）

**唯一需要你改的**：`package.json` 里的 `repository.url` 占位符
`<your-account>` 换成你的 GitHub 用户名。

## 2. 发布到 npm

```bash
cd dsh-deepseek-capture
npm login                 # 登录 npm 账号
npm publish               # 发布
```

> 发布后包名是 `dsh-deepseek-capture`（想换成作用域包如 `@you/dsh-deepseek-capture`，改 `name` 即可）。

## 3. 建 GitHub 仓库并打 topic

1. 在 GitHub 新建仓库，把本目录 push 上去（含 `extension/`）。
2. 仓库 **Settings → Topics** 添加 `dsh-plugin`（这是关键——生态市场靠这个话题自动收录）。
3. （可选）再加 `deepseek-harness`、`deepseek`、`capture` 等话题。

添加 `dsh-plugin` 话题后，[AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace)、[bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace)、[Oh-My-DSH](https://github.com/NoWint/Oh-My-DSH) 等市场会自动同步收录。

## 4. 用户侧安装

```bash
# 1. 插件
dsh plugin --profile web add dsh-deepseek-capture
# 重启 dsh web，刷新浏览器

# 2. 浏览器扩展（随 npm 包发布，手动加载）
#    位置：node_modules/dsh-deepseek-capture/extension/
#    chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 extension/ 目录
```

## 5. 验证清单

- [x] `npm pack --dry-run`：18 文件（lib + extension 全套 + 文档），`extension/` 随包发布
- [x] **干净环境安装测试**（隔离 DSH_HOME + 全新 profile）：tarball → pnpm add →
      `dsh plugin` 自动 reconcile → 插件加载无错误 → stats/ingest/import 全通 →
      `node_modules/dsh-deepseek-capture/extension/` 文件齐全 → 客户端 bundle 正常服务
- [ ] `npm publish` 成功，`npm view dsh-deepseek-capture` 能查到
- [ ] 干净环境 `dsh plugin --profile web add dsh-deepseek-capture` → 重启 → 侧边栏出现「⛁ DeepSeek 捕获」按钮
- [ ] 扩展在 chat.deepseek.com 打开 → 对话 → popup 显示「已同步」
- [ ] 面板统计卡显示累计 Token / 对话数
- [ ] 点开对话 → 勾选消息 → 导入 → 左侧会话列表出现新会话，历史为选中消息

## 注意事项

- **服务端改动需重启**：DSH 用 ESM import 缓存，服务端半区（lib/index.js）改动
  后必须重启 `dsh web` 才生效；客户端半区（lib/client.js）是 no-cache 实时读盘，
  改完刷新即可。
- **Node 版本**：SQLite 搜索需要 Node 22.5+（`node:sqlite`）；不可用时自动降级
  为纯 JSON 存储 + LIKE 搜索，插件其余功能不受影响。
- **headless 兼容**：webServer 通过 `ctx.inject` 可选注入，headless profile
  （无 Web 组合）也能加载插件（仅命令/skill 生效，无 /capture 路由）；
  已在隔离 DSH_HOME + 全新 headless profile 实测通过（插件加载无错、不破坏启动）。
- **浏览器扩展与插件分开发布**：扩展随 npm 包分发但只能手动加载
  （chrome://extensions，Chrome 策略限制命令行加载 unpacked 扩展）；
  后续可提交 Chrome 商店；插件走 npm。
