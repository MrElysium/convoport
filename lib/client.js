/**
 * convoport — Convoport插件（客户端半区，Web UI）
 *
 * 在对话区视图 tab（conversation.view 槽位）注册「⛁ Convoport」页，
 * 位于「轨迹」旁边：展示捕获统计 + 会话列表 + 搜索；点击会话进入消息级
 * 选择视图，勾选需要的消息（快捷「仅开头/仅结尾」）后一键导入当前工作区
 * 新建 Harness 会话。
 *
 * 本文件为手工编写的模块 bundle（与 tsdown 产出的 client.js 同构）：
 * window.__ModuleLoader__.load({ id, factory })，factory 内只能 require
 * 外链白名单中的包（react / react/jsx-runtime / dsh-client-ui-primitives 等）。
 */
window.__ModuleLoader__.load({
	id: "convoport",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// ── 文案 ──────────────────────────────────────────────────────────────
		const NS = "convoport";
		const zh = {
			"viewLabel": "Convoport",
			"title": "⛁ Convoport",
			"subtitle": "自动捕获 · 100% 本地 · 按消息导入工作区",
			"loading": "加载中…",
			"error": "出错了：",
			"totalTokens": "累计节省 Token",
			"conversations": "累计对话",
			"today": "今日捕获",
			"todayTokens": "今日 Token",
			"estUSD": "估算节省",
			"recent": "最近捕获",
			"empty": "（暂无捕获。安装浏览器扩展并在 chat.deepseek.com 对话后自动出现。）",
			"msgs": "条",
			"tk": "tk",
			"imported": "已导入",
			"notImported": "未导入",
			"pick": "选择消息 →",
			"back": "← 返回资产列表",
			"pickHint": "勾选要导入的消息，导入后将在当前工作区新建一个 Harness 会话，选中消息按顺序成为该会话的历史记录。",
			"pickHead": "仅开头 3 条",
			"pickTail": "仅结尾 3 条",
			"pickAll": "全选",
			"pickNone": "清空",
			"import": "导入选中到新会话",
			"importedOk": "已新建会话，导入",
			"close": "关闭",
			"selectedN": "已选 %s 条 · %s tk",
			"roleUser": "用户",
			"searchPlaceholder": "搜索捕获的对话…",
			"searchBtn": "搜索",
			"searchResult": "搜索结果（%s）",
			"searchClear": "✕ 清除",
			"searchEmpty": "无匹配消息",
			"searching": "搜索中…",
			"importedMsg": "%s 条 → 会话 %s…（左侧会话列表可见，可继续对话）",
			"todayUnit": "今日 %s 段",
			"untitled": "未命名"
		};
		const en = {
			"viewLabel": "Convoport",
			"title": "⛁ Convoport",
			"subtitle": "Auto-capture · 100% local · import by message",
			"loading": "Loading…",
			"error": "Error: ",
			"totalTokens": "Total tokens saved",
			"conversations": "Conversations",
			"today": "Captured today",
			"todayTokens": "Tokens today",
			"estUSD": "Est. savings",
			"recent": "Recent captures",
			"empty": "(Nothing captured yet. Install the extension and chat on chat.deepseek.com.)",
			"msgs": "msgs",
			"tk": "tk",
			"imported": "Imported",
			"notImported": "Not imported",
			"pick": "Pick messages →",
			"back": "← Back to list",
			"pickHint": "Check the messages to import. Import creates a new Harness session in the current workspace with the selected messages as history.",
			"pickHead": "First 3 only",
			"pickTail": "Last 3 only",
			"pickAll": "All",
			"pickNone": "Clear",
			"import": "Import selected → new session",
			"importedOk": "Session created, imported",
			"close": "Close",
			"selectedN": "Selected %s msgs · %s tk",
			"roleUser": "User",
			"searchPlaceholder": "Search captured conversations…",
			"searchBtn": "Search",
			"searchResult": "Results (%s)",
			"searchClear": "✕ Clear",
			"searchEmpty": "No matching messages",
			"searching": "Searching…",
			"importedMsg": "%s msgs → session %s… (visible in the sidebar session list, continue chatting)",
			"todayUnit": "Today %s",
			"untitled": "Untitled"
		};

		const V = {
			bg: "var(--dsw-alias-bg-base, #ffffff)",
			bg2: "var(--dsw-alias-bg-l2, #f6f6f8)",
			border: "var(--dsw-alias-border-l2, #d8d8d8)",
			text: "var(--dsw-alias-label-primary, #161616)",
			text2: "var(--dsw-alias-label-secondary, #444)",
			text3: "var(--dsw-alias-label-tertiary, #888)",
			accent: "var(--dsw-alias-accent-strong, #2f6fed)",
			ok: "var(--dsw-alias-state-success-primary, #1a9d63)",
			error: "var(--dsw-alias-state-error-primary, #d03050)"
		};

		function errorMessage(error) {
			if (error === null || error === void 0) return "unknown error";
			if (typeof error === "object" && "message" in error) return String(error.message);
			return String(error);
		}

		/** 调用服务端 /capture 路由（同源，与 dsh-md-quiz 的 fetch 模式一致）。 */
		async function api(path, opts) {
			const res = await fetch(path, opts);
			const data = await res.json().catch(() => null);
			if (!res.ok || data === null || data.ok !== true) {
				throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
			}
			return data;
		}

		const fmt = (n) => Number(n || 0).toLocaleString("en-US");

		// ── 捕获面板（对话区 tab 全宽视图） ──────────────────────────────────
		function CapturePanel({ t, locale, sessionId }) {
			const [stats, setStats] = react.useState(null);
			const [sessions, setSessions] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [picking, setPicking] = react.useState(null); // 选中的捕获会话 id
			const [msgs, setMsgs] = react.useState(null);       // 消息选择视图的消息数组
			const [picked, setPicked] = react.useState(new Set());
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [searchQ, setSearchQ] = react.useState("");
			const [searchHits, setSearchHits] = react.useState(null);
			const [searching, setSearching] = react.useState(false);

			const refresh = react.useCallback(async () => {
				setError(null);
				try {
					const [s, l] = await Promise.all([
						api("/capture/stats"),
						api("/capture/sessions")
					]);
					setStats(s.stats);
					setSessions(l.sessions);
				} catch (e) {
					setError(errorMessage(e));
				}
			}, []);

			react.useEffect(() => { void refresh(); }, [refresh]);

			const openPick = async (id) => {
				setError(null);
				setPicked(new Set());
				try {
					const d = await api(`/capture/messages?id=${encodeURIComponent(id)}`);
					setMsgs(d.session.messages || []);
					setPicking(id);
				} catch (e) {
					setError(errorMessage(e));
				}
			};

			const doImport = async () => {
				const indexes = [...picked].sort((a, b) => a - b);
				setBusy(true);
				setError(null);
				setNotice(null);
				try {
					const d = await api("/capture/import", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id: picking, indexes, sessionId })
					});
					setNotice({ kind: "ok", text: t("importedOk") + " " + t("importedMsg")
						.replace("%s", String(d.importedMessages))
						.replace("%s", String(d.sessionId).slice(0, 12)) });
					setPicking(null);
					setMsgs(null);
					setPicked(new Set());
					void refresh();
				} catch (e) {
					setError(errorMessage(e));
				} finally {
					setBusy(false);
				}
			};

			const doSearch = async () => {
				const q = searchQ.trim();
				if (!q) { setSearchHits(null); return; }
				setSearching(true);
				setError(null);
				try {
					const d = await api(`/capture/search?q=${encodeURIComponent(q)}`);
					setSearchHits(d.hits || []);
				} catch (e) {
					setError(errorMessage(e));
				} finally {
					setSearching(false);
				}
			};

			// 统计卡
			const kpi = (k, v, color) => react.createElement("div", {
				key: k,
				style: { background: V.bg2, border: `1px solid ${V.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }
			}, [
				react.createElement("div", { key: "k", style: { fontSize: 10.5, color: V.text3 } }, t(k)),
				react.createElement("div", { key: "v", style: { fontSize: 16, fontWeight: 600, marginTop: 2, color: color || V.text, fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)" } }, v)
			]);

			const rowStyle = { display: "flex", gap: 6, alignItems: "center", padding: "8px 10px", borderRadius: 8, cursor: "pointer", border: `1px solid ${V.border}`, background: V.bg2, marginBottom: 6 };
			const btnStyle = { padding: "6px 10px", fontSize: 12, border: `1px solid ${V.border}`, background: V.bg, color: V.text, borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 };
			const primaryStyle = { ...btnStyle, background: V.accent, borderColor: V.accent, color: "#fff", fontWeight: 600 };
			const chipStyle = (active) => ({ padding: "2px 8px", fontSize: 11, borderRadius: 999, background: active ? V.accent : "transparent", color: active ? "#fff" : V.text3, border: `1px solid ${active ? V.accent : V.border}`, whiteSpace: "nowrap", cursor: "pointer" });

			let body;
			if (error !== null) {
				body = react.createElement("div", { style: { color: V.error, fontSize: 12, padding: "12px 0", wordBreak: "break-all" } }, t("error") + error);
			} else if (picking !== null && msgs !== null) {
				// ── 消息级选择视图 ──
				const total = msgs.length;
				const toggle = (i) => {
					const next = new Set(picked);
					if (next.has(i)) next.delete(i); else next.add(i);
					setPicked(next);
				};
				const setSel = (fn) => {
					const next = new Set();
					msgs.forEach((_, i) => { if (fn(i)) next.add(i); });
					setPicked(next);
				};
				const selCount = picked.size;
				const selTokens = [...picked].reduce((a, i) => a + (msgs[i].token_count || 0), 0);
				body = react.createElement("div", null, [
					react.createElement("div", { key: "back", style: { fontSize: 12, color: V.accent, cursor: "pointer", marginBottom: 8, display: "inline-block" }, onClick: () => { setPicking(null); setMsgs(null); } }, t("back")),
					react.createElement("div", { key: "hint", style: { fontSize: 11.5, color: V.text3, lineHeight: 1.6, marginBottom: 10 } }, t("pickHint")),
					react.createElement("div", { key: "toolbar", style: { display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 8 } }, [
						react.createElement("span", { key: "info", style: { fontSize: 11.5, color: V.text2, marginRight: 4 } }, t("selectedN").replace("%s", String(selCount)).replace("%s", fmt(selTokens))),
						react.createElement("span", { key: "h", style: chipStyle(false), onClick: () => setSel(i => i < 3) }, t("pickHead")),
						react.createElement("span", { key: "tl", style: chipStyle(false), onClick: () => setSel(i => i >= total - 3) }, t("pickTail")),
						react.createElement("span", { key: "a", style: chipStyle(false), onClick: () => setSel(() => true) }, t("pickAll")),
						react.createElement("span", { key: "n", style: chipStyle(false), onClick: () => setSel(() => false) }, t("pickNone"))
					]),
					react.createElement("div", { key: "list", style: { maxHeight: 320, overflowY: "auto", marginBottom: 8 } },
						msgs.map((m, i) => {
							const sel = picked.has(i);
							const isUser = m.role === "user";
							return react.createElement("div", {
								key: i,
								style: { ...rowStyle, borderColor: sel ? V.accent : V.border, background: sel ? "var(--dsw-alias-accent-weak, rgba(47,111,237,.08))" : V.bg2 },
								onClick: () => toggle(i)
							}, [
								react.createElement("input", { key: "cb", type: "checkbox", checked: sel, readOnly: true, style: { accentColor: V.accent, pointerEvents: "none" } }),
								react.createElement("div", { key: "b", style: { flex: 1, minWidth: 0 } }, [
									react.createElement("div", { key: "w", style: { display: "flex", gap: 8, fontSize: 10.5, color: V.text3, marginBottom: 2 } }, [
										react.createElement("span", { key: "r", style: { color: isUser ? V.accent : V.ok, fontWeight: 600 } }, isUser ? t("roleUser") : "DeepSeek"),
										react.createElement("span", { key: "tm", style: { fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)" } }, m.ts ? String(m.ts).slice(11, 16) : ""),
										react.createElement("span", { key: "tk", style: { fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)" } }, `${m.token_count || 0} tk`)
									]),
									react.createElement("div", { key: "tx", style: { fontSize: 12, color: V.text, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" } }, String(m.content || "").slice(0, 200))
								])
							]);
						})
					),
					react.createElement("button", { key: "imp", type: "button", style: { ...primaryStyle, width: "100%" }, disabled: busy || selCount === 0, onClick: doImport },
						`${t("import")} (${selCount})`)
				]);
			} else if (sessions === null) {
				body = react.createElement("div", { style: { color: V.text3, fontSize: 12, padding: "14px 0" } }, t("loading"));
			} else {
				// ── 资产列表视图（含搜索） ──
				const statGrid = react.createElement("div", { key: "kpi", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 } }, [
					kpi("totalTokens", fmt(stats ? stats.totalTokens : 0), V.ok),
					kpi("conversations", fmt(stats ? stats.conversations : 0)),
					kpi("today", stats ? t("todayUnit").replace("%s", String(stats.todayCaptured)) : "0"),
					kpi("estUSD", stats ? `~$${stats.estUSD}` : "~$0")
				]);
				// 搜索框
				const searchBox = react.createElement("div", { key: "search", style: { display: "flex", gap: 6, marginBottom: 10 } }, [
					react.createElement("input", {
						key: "in", type: "text", value: searchQ,
						placeholder: t("searchPlaceholder"),
						style: { flex: 1, minWidth: 0, padding: "6px 9px", fontSize: 12, color: V.text, background: V.bg, border: `1px solid ${V.border}`, borderRadius: 8, outline: "none" },
						onChange: (e) => { setSearchQ(e.target.value); if (!e.target.value.trim()) setSearchHits(null); },
						onKeyDown: (e) => { if (e.key === "Enter") doSearch(); }
					}),
					react.createElement("button", { key: "b", type: "button", style: { padding: "6px 10px", fontSize: 12, border: `1px solid ${V.border}`, background: V.bg2, color: V.text, borderRadius: 8, cursor: "pointer" }, onClick: doSearch, disabled: searching }, searching ? t("searching") : t("searchBtn"))
				]);
				// 搜索结果视图
				let searchView = null;
				if (searchHits !== null) {
					searchView = react.createElement("div", { key: "sv" }, [
						react.createElement("div", { key: "sh", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } }, [
							react.createElement("span", { key: "t", style: { fontSize: 11.5, color: V.text3 } }, t("searchResult").replace("%s", String(searchHits.length))),
							react.createElement("span", { key: "c", style: { fontSize: 11, color: V.accent, cursor: "pointer" }, onClick: () => setSearchHits(null) }, t("searchClear"))
						]),
						searchHits.length === 0
							? react.createElement("div", { key: "e", style: { color: V.text3, fontSize: 12, padding: "8px 0" } }, t("searchEmpty"))
							: react.createElement("div", { key: "l", style: { maxHeight: 260, overflowY: "auto" } },
								searchHits.map((h, i) => react.createElement("div", {
									key: i,
									style: { ...rowStyle, cursor: "pointer" },
									onClick: () => { if (h.session_id) openPick(h.session_id); }
								}, [
									react.createElement("span", { key: "i", style: { fontSize: 11 } }, "🔎"),
									react.createElement("div", { key: "b", style: { flex: 1, minWidth: 0 } }, [
										react.createElement("div", { key: "t", style: { fontSize: 11.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: V.text } }, h.title || t("untitled")),
										react.createElement("div", { key: "c", style: { fontSize: 11, color: V.text2, marginTop: 2, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } }, String(h.content || ""))
									])
								]))
							)
					]);
				}
				const list = sessions.length === 0
					? react.createElement("div", { key: "empty", style: { color: V.text3, fontSize: 11.5, padding: "8px 2px", lineHeight: 1.6 } }, t("empty"))
					: react.createElement("div", { key: "list", style: { maxHeight: 300, overflowY: "auto" } },
						sessions.map(s => react.createElement("div", {
							key: s.id,
							style: rowStyle,
							onClick: () => openPick(s.id)
						}, [
							react.createElement("span", { key: "i", style: { fontSize: 12 } }, "⛁"),
							react.createElement("div", { key: "b", style: { flex: 1, minWidth: 0 } }, [
								react.createElement("div", { key: "t", style: { fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: V.text } }, s.title),
								react.createElement("div", { key: "m", style: { fontSize: 10.5, color: V.text3, marginTop: 2, fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)" } }, `${s.messages} ${t("msgs")} · ${fmt(s.token_count)} ${t("tk")}`)
							]),
							react.createElement("span", { key: "st", style: { fontSize: 10, color: s.imported ? V.ok : V.text3, whiteSpace: "nowrap" } }, s.imported ? t("imported") : t("notImported")),
							react.createElement("span", { key: "pk", style: { fontSize: 11, color: V.accent, whiteSpace: "nowrap" } }, t("pick"))
						])));
				body = react.createElement("div", null, [
					statGrid,
					searchBox,
					searchView,
					searchHits === null ? react.createElement("div", { key: "recent", style: { fontSize: 11.5, color: V.text3, marginBottom: 6 } }, t("recent")) : null,
					searchHits === null ? list : null
				]);
			}

			// 外壳：对话区 tab 全宽铺满
			return react.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: V.bg, overflow: "hidden", padding: "18px 24px" } }, [
				react.createElement("div", { key: "hd", style: { display: "flex", alignItems: "center", gap: 8, padding: "0 0 12px", borderBottom: `1px solid ${V.border}`, marginBottom: 14 } }, [
					react.createElement("span", { key: "i", style: { fontSize: 14 } }, "⛁"),
					react.createElement("div", { key: "tt", style: { flex: 1, minWidth: 0 } }, [
						react.createElement("div", { key: "t", style: { fontWeight: 600, fontSize: 16 } }, t("title")),
						react.createElement("div", { key: "s", style: { fontSize: 10.5, color: V.text3 } }, t("subtitle"))
					])
				]),
				notice !== null ? react.createElement("div", { key: "nt", style: { color: notice.kind === "ok" ? V.ok : V.error, fontSize: 12.5, marginBottom: 10, wordBreak: "break-all" } }, notice.text) : null,
				react.createElement("div", { key: "bd", style: { flex: 1, overflowY: "auto", minHeight: 0 } }, body)
			]);
		}

		// ── 对话区 tab 视图（conversation.view）：放在「轨迹」旁边的完整页面 ──
		function CaptureView({ t, locale, sessionId }) {
			const T = typeof t === "function" ? t : (key) => (locale && locale[NS] && locale[NS][key]) || zh[key] || key;
			return react.createElement("div", { style: { height: "100%", display: "flex", flexDirection: "column", minHeight: 0 } },
				react.createElement(CapturePanel, { t: T, locale, sessionId })
			);
		}

		// ── 槽位挂载 ──
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "convoport: dictionaries");
			const t = ctx.locale.bind(NS);

			// 对话区视图 tab：放在「轨迹」旁边（现有 tab order：聊天=0、轨迹/阅读区=20；
			// 用 30 排在它们之后，紧邻显示）
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "convoport",
				order: 30,
				label: () => t("viewLabel"),
				locale: NS,
				inject: (sessionId) => ({ sessionId })
			}, CaptureView));
		}

		exports.CapturePanel = CapturePanel;
		exports.CaptureView = CaptureView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
