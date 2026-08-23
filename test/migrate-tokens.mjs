/**
 * 一次性迁移：把既有捕获里 token_count<=0 的消息按 4 字符/token 启发式重算，
 * 并同步 index.json 的会话 token 汇总。幂等，可重复运行。
 * 运行：node test/migrate-tokens.mjs
 */
import { estimateTokens, normalizeTs } from "../lib/index.js";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";

const root = pathJoin(process.env.DSH_HOME || pathJoin(homedir(), ".dsh"), "capture");
const indexFile = pathJoin(root, "index.json");
const sessionsDir = pathJoin(root, "sessions");

const index = JSON.parse(await readFile(indexFile, "utf8"));

for (const meta of Object.values(index.sessions)) {
  const file = pathJoin(sessionsDir, `${meta.id}.json`);
  let session;
  try {
    session = JSON.parse(await readFile(file, "utf8"));
  } catch {
    continue;
  }
  let total = 0;
  let changed = 0;
  for (const m of session.messages || []) {
    const official = Number(m.token_count);
    const tc = (Number.isFinite(official) && official > 0) ? official : estimateTokens(m.content);
    if (tc !== m.token_count) changed++;
    m.token_count = tc;
    total += tc;
    // 时间戳统一成 ISO（DeepSeek inserted_at 是 Unix 秒级）
    const ts = normalizeTs(m.ts);
    if (ts !== m.ts) { m.ts = ts; changed++; }
  }
  if (changed > 0) {
    meta.token_count = total;
    await writeFile(file, JSON.stringify(session, null, 2), "utf8");
    console.log(`migrated ${meta.id} (${meta.title}): ${changed} msgs → total ${total} tk`);
  } else {
    console.log(`unchanged ${meta.id} (${meta.title}): total ${meta.token_count} tk`);
  }
}

await writeFile(indexFile, JSON.stringify(index, null, 2), "utf8");
console.log("✅ migration done");
