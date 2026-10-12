// Design Ref: §3 — OpenAI Responses API 호출 창구. SDK 없이 기본 fetch로 부른다 (하루 2~3회뿐이라 충분).
// CLAUDE.md 2장: 개발 중 실제 호출 금지 → AI_MODE=live 일 때만 실제로 부르고, 그 외에는 가짜 응답을 돌려준다.
// 이 파일은 서버에서만 쓴다. 화면 조각(components/)에서 import하지 않는다.
import { timeoutSignal } from "@/lib/abort";
import { readTextLimited, ResponseTooLargeError } from "@/lib/http";

const OPENAI_URL = "https://api.openai.com/v1/responses";
/**
 * 한 번 호출의 기본 최대 대기 시간. 실제로는 자동 실행 전체 시간 예산(lib/pipeline.ts)의 남은 시간과
 * 둘 중 먼저 끝나는 쪽에서 멈춘다.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

export type AiMode = "mock" | "live";
/** light = 저가 모델(1차 선별), main = 상위 모델(최종 분석) — Design §2 */
export type ModelTier = "light" | "main";

/** 설정이 잘못돼 실행하면 안 되는 경우. 자동 실행은 이 오류를 "실패"로 기록한다. */
export class AiConfigError extends Error {
  name = "AiConfigError";
}

/**
 * 지금 실제 OpenAI를 부를지 정한다.
 * Design §4: 배포(VERCEL_ENV=production)에서는 가짜로 넘어가지 않는다 — AI_MODE=live 와 키·모델명이 모두 있어야 한다.
 */
export function getAiMode(): AiMode {
  const live = process.env.AI_MODE === "live";
  const isProduction = process.env.VERCEL_ENV === "production";

  if (isProduction && !live) {
    throw new AiConfigError("배포 환경인데 AI_MODE=live 가 설정되지 않았습니다");
  }
  if (live) {
    const missing = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_LIGHT_MODEL"].filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new AiConfigError(`AI_MODE=live 인데 환경변수가 없습니다: ${missing.join(", ")}`);
    }
  }
  return live ? "live" : "mock";
}

/** 모델명은 코드에 쓰지 않고 환경변수에서 읽는다 (CLAUDE.md 2장). */
function modelFor(tier: ModelTier): string {
  const name = tier === "main" ? process.env.OPENAI_MODEL : process.env.OPENAI_LIGHT_MODEL;
  if (!name) throw new AiConfigError(`모델명 환경변수가 없습니다 (${tier})`);
  return name;
}

export interface AiRequest<T> {
  tier: ModelTier;
  /** 지시문 (역할·규칙) */
  instructions: string;
  /** 이번에 처리할 내용 */
  input: string;
  /** 응답 양식 (JSON Schema). 이 양식대로만 답하게 한다 — 구조화 출력 */
  schema: { name: string; schema: Record<string, unknown> };
  /** 가짜 모드에서 돌려줄 응답. 실제 호출 없이 개발·시험하는 데 쓴다. */
  mock: () => T;
}

export interface AiResult<T> {
  /** 응답 양식대로 읽은 결과. 형식·개수 검증은 호출한 쪽(lib/ai/validate.ts)이 한다. */
  data: T;
  mode: AiMode;
  /** 비용 확인용 사용량 (가짜 모드에서는 0) */
  usage: { inputTokens: number; outputTokens: number };
}

/** OpenAI 응답 본문의 최대 크기 (응답은 이슈 20건 JSON, 실측 수십 KB) */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * 실패 기록에 남겨도 되는 OpenAI 오류 값 (2026-10-12 공개 전 보안 점검).
 * 응답의 설명 문장(message)은 기록하지 않는다 — 키가 틀렸을 때 가린 키 일부가 섞여 오기 때문이다.
 * 목록에 없는 값은 "기타"로만 남긴다.
 */
const ALLOWED_ERROR_VALUES = new Set([
  // error.code
  "invalid_api_key", "insufficient_quota", "rate_limit_exceeded", "model_not_found", "context_length_exceeded",
  "server_error", "unsupported_parameter", "unsupported_value", "invalid_value", "invalid_json_schema",
  // error.type
  "invalid_request_error", "authentication_error", "permission_error", "not_found_error", "rate_limit_error",
  "api_error", "overloaded_error", "insufficient_quota_error",
]);
const ALLOWED_STATUS = new Set(["completed", "incomplete", "failed", "cancelled", "in_progress", "queued"]);
const ALLOWED_INCOMPLETE_REASONS = new Set(["max_output_tokens", "content_filter"]);

function allowed(value: unknown, list: Set<string>): string {
  return typeof value === "string" && list.has(value) ? value : "기타";
}

/** 기록용 오류 요약: HTTP 상태 + 허용한 오류 코드·종류만 */
function describeError(httpStatus: number, error: ResponsesApiBody["error"]): string {
  const code = error?.code ? allowed(error.code, ALLOWED_ERROR_VALUES) : "없음";
  const type = error?.type ? allowed(error.type, ALLOWED_ERROR_VALUES) : "없음";
  return `OpenAI 오류 HTTP ${httpStatus} (code: ${code}, type: ${type})`;
}

/** Responses API 응답에서 필요한 부분만 정의한다. message 는 일부러 읽지 않는다. */
interface ResponsesApiBody {
  status?: string;
  error?: { code?: unknown; type?: unknown } | null;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 응답의 output 목록에서 AI가 쓴 글(output_text)만 이어 붙인다. */
function extractText(body: ResponsesApiBody): string {
  return (body.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export interface CallOptions {
  /** 자동 실행 전체의 취소 신호. 시간 예산이 끝나면 대기 중인 호출도 멈춘다. */
  signal?: AbortSignal;
  /** 이 호출 하나의 최대 대기 시간 */
  timeoutMs?: number;
}

/** OpenAI를 한 번 부른다. 실패하면 오류를 던지고, 실패 기록은 자동 실행 쪽이 남긴다. */
export async function callAi<T>(req: AiRequest<T>, options: CallOptions = {}): Promise<AiResult<T>> {
  options.signal?.throwIfAborted();
  if (getAiMode() === "mock") {
    return { data: req.mock(), mode: "mock", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    cache: "no-store",
    signal: timeoutSignal(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelFor(req.tier),
      instructions: req.instructions,
      input: req.input,
      store: false, // 대화 기록을 OpenAI에 남기지 않는다.
      text: { format: { type: "json_schema", name: req.schema.name, schema: req.schema.schema, strict: true } },
    }),
  });

  // 응답 크기를 제한해 읽는다. 너무 크면 ResponseTooLargeError (이번 실행 실패로 기록, 직전 결과 유지).
  let body: ResponsesApiBody;
  try {
    body = JSON.parse(await readTextLimited(res, MAX_RESPONSE_BYTES, "OpenAI")) as ResponsesApiBody;
  } catch (error) {
    if (error instanceof ResponseTooLargeError) throw error;
    body = {};
  }
  if (!res.ok) {
    // CLAUDE.md 7장: 응답의 설명 문장은 기록하지 않는다. HTTP 상태와 허용한 오류 코드·종류만 남긴다.
    throw new Error(describeError(res.status, body.error));
  }
  if (body.status !== "completed") {
    const status = body.status ? allowed(body.status, ALLOWED_STATUS) : "알 수 없음";
    const reason = body.incomplete_details?.reason ? allowed(body.incomplete_details.reason, ALLOWED_INCOMPLETE_REASONS) : "";
    const code = body.error ? ` ${describeError(res.status, body.error)}` : "";
    throw new Error(`OpenAI 응답이 끝나지 않음: ${status} ${reason}${code}`.trim());
  }

  let data: T;
  try {
    data = JSON.parse(extractText(body)) as T;
  } catch {
    throw new Error("OpenAI 응답을 JSON으로 읽을 수 없습니다");
  }

  return {
    data,
    mode: "live",
    usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
  };
}
