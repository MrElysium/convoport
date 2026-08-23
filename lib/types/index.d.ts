/**
 * convoport — Convoport插件（类型声明）
 */

/** 一条被捕获的 DeepSeek 网页对话消息。 */
export interface CapturedMessage {
  role: "user" | "assistant";
  content: string;
  /** ISO8601 消息时间（来自 DeepSeek 官方 API inserted_at，缺省为捕获时间）。 */
  ts?: string;
  /** 官方累计 token 数（accumulated_token_count 差值），缺省用 4 字符/token 估算。 */
  token_count?: number;
  /** DeepSeek 官方 message_id，用于幂等去重。 */
  message_id?: number | string | null;
}

/** 浏览器扩展上报的对话负载。 */
export interface CaptureIngestBody {
  source?: string;
  url?: string;
  title?: string;
  captured_at?: string;
  messages: CapturedMessage[];
}

/** 捕获会话索引条目。 */
export interface CaptureSessionMeta {
  id: string;
  source: string;
  url: string;
  title: string;
  captured_at: string;
  messages: number;
  token_count: number;
  imported: boolean;
}

/** 统计结果。 */
export interface CaptureStats {
  totalTokens: number;
  conversations: number;
  todayCaptured: number;
  todayTokens: number;
  estUSD: number;
  pricePer1k: number;
  tokenizer: string;
}

/** 消息级导入请求。 */
export interface CaptureImportBody {
  id: string;
  /** 要导入的消息下标（升序即可，服务端会排序）。 */
  indexes: number[];
}

/** 导入结果。 */
export interface CaptureImportResult {
  ok: true;
  sessionId: string;
  importedMessages: number;
  totalTokens: number;
  title: string;
}

export interface CapturePlugin {}
