/**
 * 修复历史捕获数据的 token 计数。
 *
 * 背景：早期版本的扩展在 DeepSeek 官方接口未返回 accumulated_token_count 时，
 * 每条消息的 token_count 都被记为 0（服务端兜底只认“缺失/NaN”，显式 0 被原样保留），
 * 导致所有会话统计为 0 tk、估算节省 ¥0.00。
 *
 * 本脚本对所有 token_count <= 0 的消息按 4 字符/token 启发式重算，
 * 并回写会话文件与 index.json。幂等：已 >0 的消息不动，可重复运行。
 *
 * 用法：node scripts/repair-tokens.mjs [captureRoot]
 *   captureRoot 缺省取 $DSH_HOME/capture，再退到 ~/.dsh/capture。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { estimateTokens } from "../lib/index.js";

function resolveRoot() {
  const arg = process.argv[2];
  if (arg) return arg;
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, "capture");
  return join(homedir(), ".dsh", "capture");
}

async function main() {
  const root = resolveRoot();
  const indexPath = join(root, "index.json");
  const sessionsDir = join(root, "sessions");

  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const ids = Object.keys(index.sessions);
  console.log(`capture root: ${root}  (${ids.length} sessions)`);

  let fixedMessages = 0;
  let fixedSessions = 0;
  for (const id of ids) {
    const meta = index.sessions[id];
    const filePath = join(sessionsDir, `${id}.json`);
    const file = JSON.parse(await readFile(filePath, "utf8"));
    const messages = file.messages || [];
    let changed = false;
    let sum = 0;
    for (const m of messages) {
      const tc = Number(m.token_count);
      if (Number.isFinite(tc) && tc > 0) {
        sum += tc;
        continue;
      }
      const est = estimateTokens(m.content ?? "");
      m.token_count = est; // 回写消息级计数
      sum += est;
      changed = true;
      fixedMessages++;
    }
    if (changed) {
      await writeFile(filePath, JSON.stringify(file, null, 2), "utf8");
      meta.token_count = sum;
      meta.messages = messages.length;
      fixedSessions++;
      console.log(`  ${id}  ${meta.title}  ${messages.length} 条 → ${sum.toLocaleString()} tk`);
    } else {
      console.log(`  ${id}  ${meta.title}  无需修复（${sum.toLocaleString()} tk）`);
    }
  }

  if (fixedSessions > 0) {
    await writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
    console.log(`\n✅ 已修复 ${fixedSessions} 个会话、${fixedMessages} 条消息的 token 计数并回写 index.json`);
  } else {
    console.log("\n没有需要修复的会话。");
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
