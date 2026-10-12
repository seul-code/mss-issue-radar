// Design Ref: §2 데이터 흐름 — 하루 1회 실행: 수집 → 전처리 → 1차 선별 → (48시간 확장) → 보도자료 본문 → 분석 → 검증.
// 저장과 하루 1회 중복 방지는 자동 실행 주소(app/api/cron)가 맡는다. 이 함수는 결과를 만들기만 한다.
// 실패하면 오류를 던진다. 호출한 쪽이 "실패"로 기록하고 직전 결과를 유지한다 (Design §5).
// 시간 예산: 호출한 쪽이 정한 마감 시각(deadlineAt)과 취소 신호(signal)를 모든 수집·AI 호출에 넘긴다.
// 마감이 가까우면 48시간 확장을 건너뛰고, 최종 분석에는 남은 시간만 준다 (실패 기록을 저장할 시간을 남기기 위해).
import { callAi, getAiMode, type AiMode } from "@/lib/ai/client";
import { buildAnalysisRequest, buildScreeningRequest } from "@/lib/ai/prompts";
import { analysisToIssues, pickCandidates, withRepresentativeBody } from "@/lib/ai/validate";
import { fetchMssDetail } from "@/lib/sources/mss-detail";
import { fetchMssRss } from "@/lib/sources/mss-rss";
import { fetchNewsRss } from "@/lib/sources/news-rss";
import { fetchPolicyNews } from "@/lib/sources/policy-news";
import { preprocess } from "@/lib/sources/preprocess";
import type { CollectionWindow, Issue, RawItem } from "@/lib/types";

/** PRD 5장: 24시간 안의 이슈가 5건 미만이면 48시간까지 넓힌다. */
const MIN_ISSUES_BEFORE_EXPANSION = 5;

/** 1차 선별(저가 모델) 한 번의 최대 대기 시간 */
const SCREENING_TIMEOUT_MS = 90_000;
/** 최종 분석(상위 모델)의 최대 대기 시간 */
const ANALYSIS_TIMEOUT_MS = 150_000;
/** 최종 분석을 시도하려면 최소한 남아 있어야 하는 시간. 선별은 이만큼을 남기고 시간을 쓴다. */
const MIN_ANALYSIS_MS = 60_000;
/** 48시간 확장 선별에 최소한 필요한 시간. 이보다 적게 남으면 확장을 건너뛴다. */
const MIN_EXPANSION_MS = 30_000;

/** PRD 5장 점검 지표: 높음이 이 비율을 넘으면 기록에 "기준 점검 필요"로 남긴다 (목표·강제 아님, 화면 표시 안 함). */
const HIGH_RATIO_CHECK = 1 / 3;

/** 시간 예산 안에 끝낼 수 없어 멈춘 경우 */
export class PipelineBudgetError extends Error {
  name = "PipelineBudgetError";
}

/** 수집기 묶음. 시험할 때 가짜 수집기로 바꿔 끼울 수 있게 밖에서 받는다. */
export interface Collectors {
  mss: (signal?: AbortSignal) => Promise<RawItem[]>;
  policyNews: (now: Date, signal?: AbortSignal) => Promise<RawItem[]>;
  news: (signal?: AbortSignal) => Promise<{ items: RawItem[]; errors: string[] }>;
  /** 중기부 보도자료 본문 읽기 (최종 후보만) */
  mssDetail: (url: string, signal?: AbortSignal) => Promise<string | undefined>;
}

export interface PipelineOptions {
  /** 이 시각(ms)까지 끝내야 한다. 없으면 시간 예산 없이 각 호출의 제한 시간만 쓴다. */
  deadlineAt?: number;
  /** 시간 예산이 끝나면 대기 중인 수집·AI 호출을 멈추는 신호 */
  signal?: AbortSignal;
  collectors?: Collectors;
}

const DEFAULT_COLLECTORS: Collectors = {
  mss: fetchMssRss,
  policyNews: fetchPolicyNews,
  news: fetchNewsRss,
  mssDetail: fetchMssDetail,
};

export interface PipelineResult {
  /** success = 이슈 1건 이상, empty = 관련 이슈 0건 (주말·공휴일) */
  status: "success" | "empty";
  issues: Issue[];
  /** 집계 기간 (화면의 "○○ 기준 자료") */
  window: CollectionWindow;
  /** 기록·비용 확인용 요약 (화면에는 표시하지 않음) */
  stats: {
    mode: AiMode;
    windowHours: 24 | 48;
    /** 시간이 모자라 48시간 확장을 건너뛰었는지 */
    expansionSkipped: boolean;
    /** 48시간 확장 호출이 실패해 24시간 결과로 진행한 경우 그 이유 */
    expansionError?: string;
    /** 최종 분석이 올바른 빈 목록을 돌려줘 0건으로 처리했는지 */
    analysisEmpty?: boolean;
    collected: { mss: number; policyNews: number; news: number };
    /** 실패한 출처와 이유 (키 값은 포함되지 않음) */
    sourceErrors: string[];
    candidates: number;
    dropped: number;
    aiCalls: number;
    usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
    /** 이슈는 남겼지만 경고를 붙인 수 (판단 근거 없음, 원문에서 찾지 못한 수치가 있는 요약 줄) */
    warnings?: { missingReason: number; unverifiedNumberLines: number };
    /** 점검 지표: 높음 비율과 기준(1/3) 초과 여부 */
    highRatio?: { value: number; needsReview: boolean };
  };
}

/** 정부 자료 2곳이 모두 실패하면 던지는 오류 (Design §5: PRD "정부 자료 서버 장애") */
export class GovernmentSourcesError extends Error {
  name = "GovernmentSourcesError";
}

/** 운영에 꼭 필요한 설정이 빠진 경우 — 수집·AI 호출 전에 멈춘다 */
export class PipelineConfigError extends Error {
  name = "PipelineConfigError";
}

/**
 * 운영(VERCEL_ENV=production)에서 수집 전에 확인하는 필수 키 (Design §4 "필수 키가 없으면 실패").
 * AI 키·모델명은 getAiMode, Blob 토큰·CRON_SECRET 은 저장소·자동 실행 주소가 따로 확인한다.
 * 로컬·preview 에서는 확인하지 않는다 — 키 없이 가짜 수집기로 시험할 수 있게.
 */
const REQUIRED_IN_PRODUCTION = ["DATA_GO_KR_API_KEY"] as const;

function assertProductionConfig(): void {
  if (process.env.VERCEL_ENV !== "production") return;
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new PipelineConfigError(`설정 오류: ${missing.join(", ")} 없음`);
}

function reason(result: PromiseSettledResult<unknown>): string {
  return result.status === "rejected"
    ? result.reason instanceof Error
      ? result.reason.message
      : String(result.reason)
    : "";
}

export async function runDailyPipeline(
  now: Date = new Date(),
  { deadlineAt, signal, collectors = DEFAULT_COLLECTORS }: PipelineOptions = {},
): Promise<PipelineResult> {
  // 설정이 잘못됐으면(배포인데 live 아님, 필수 키 없음 등) 수집 전에 바로 멈춘다 — 실패로 기록되고 직전 결과는 유지된다.
  const mode = getAiMode();
  assertProductionConfig();
  /** 마감까지 남은 시간(ms). 시간 예산이 없으면 무한대 */
  const remaining = () => (deadlineAt === undefined ? Infinity : deadlineAt - Date.now());
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let aiCalls = 0;
  const addUsage = (u: { inputTokens: number; outputTokens: number; reasoningTokens: number }) => {
    aiCalls += 1;
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.reasoningTokens += u.reasoningTokens;
  };

  // ── 1. 수집: 정부 자료 2곳 + 언론사 RSS를 동시에 (모두 무료, AI 호출 없음). 한 곳이 실패해도 계속 간다.
  const [mssResult, policyResult, newsResult] = await Promise.allSettled([
    collectors.mss(signal),
    collectors.policyNews(now, signal),
    collectors.news(signal),
  ]);
  signal?.throwIfAborted();

  const sourceErrors: string[] = [];
  if (mssResult.status === "rejected") sourceErrors.push(`중기부 RSS: ${reason(mssResult)}`);
  if (policyResult.status === "rejected") sourceErrors.push(`정책뉴스: ${reason(policyResult)}`);
  if (mssResult.status === "rejected" && policyResult.status === "rejected") {
    throw new GovernmentSourcesError(`정부 자료 수집 실패 — ${sourceErrors.join(" / ")}`);
  }
  if (newsResult.status === "rejected") sourceErrors.push(`언론사 RSS: ${reason(newsResult)}`);
  else sourceErrors.push(...newsResult.value.errors.map((error) => `언론사 RSS: ${error}`));

  const collected = [
    ...(mssResult.status === "fulfilled" ? mssResult.value : []),
    ...(policyResult.status === "fulfilled" ? policyResult.value : []),
    ...(newsResult.status === "fulfilled" ? newsResult.value.items : []),
  ];

  // ── 2. 전처리 + 1차 선별 (24시간). 최종 분석에 쓸 시간(MIN_ANALYSIS_MS)은 남겨 둔다.
  const screen = async (windowHours: 24 | 48) => {
    const items = preprocess(collected, { now, windowHours });
    if (items.length === 0) return { candidates: [], relevantCount: 0 };
    const timeoutMs = Math.min(SCREENING_TIMEOUT_MS, remaining() - MIN_ANALYSIS_MS);
    if (timeoutMs <= 0) throw new PipelineBudgetError("시간 예산이 부족해 1차 선별을 시작하지 못했습니다");
    const response = await callAi(buildScreeningRequest(items), { signal, timeoutMs });
    addUsage(response.usage);
    return pickCandidates(items, response.data);
  };

  let windowHours: 24 | 48 = 24;
  let screening = await screen(24);

  // ── 3. 관련 이슈가 5건 미만이면 48시간으로 넓혀 한 번 더 (저가 모델 +1회).
  //       남은 시간이 모자라면 확장을 건너뛰고 24시간 결과로 진행한다.
  //       확장 호출이 실패해도 24시간 후보가 1건 이상이면 그것으로 진행한다 (다시 시도하지 않음 → 호출 수 그대로).
  //       24시간 후보가 0건이면 실패로 둔다 — 48시간을 확인하지 못했으므로 "0건"으로 기록하면 사실과 다르다.
  let expansionSkipped = false;
  let expansionError: string | undefined;
  if (screening.relevantCount < MIN_ISSUES_BEFORE_EXPANSION) {
    if (remaining() - MIN_ANALYSIS_MS >= MIN_EXPANSION_MS) {
      try {
        screening = await screen(48);
        windowHours = 48;
      } catch (error) {
        if (signal?.aborted || screening.candidates.length === 0) throw error;
        expansionError = `48시간 확장 실패 — 24시간 결과로 진행: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      expansionSkipped = true;
    }
  }

  const window: CollectionWindow = {
    from: new Date(now.getTime() - windowHours * 3600_000).toISOString(),
    to: now.toISOString(),
    hours: windowHours,
  };
  const stats = {
    mode,
    windowHours,
    expansionSkipped,
    ...(expansionError ? { expansionError } : {}),
    collected: {
      mss: mssResult.status === "fulfilled" ? mssResult.value.length : 0,
      policyNews: policyResult.status === "fulfilled" ? policyResult.value.length : 0,
      news: newsResult.status === "fulfilled" ? newsResult.value.items.length : 0,
    },
    sourceErrors,
    candidates: screening.candidates.length,
    dropped: 0,
    aiCalls,
    usage,
  };

  // ── 4. 관련 이슈 0건 → "empty" (직전 결과 유지는 호출한 쪽이 한다)
  if (screening.candidates.length === 0) {
    return { status: "empty", issues: [], window, stats: { ...stats, aiCalls } };
  }

  // ── 5. 중기부 보도자료 본문 읽기: RSS에 본문이 없어 최종 후보로 뽑힌 것만 원문 페이지를 읽는다 (PRD 6장 예외).
  //       실패하면 기존 본문(같은 사건 언론 기사)이나 제목만으로 진행한다.
  const candidates = await Promise.all(
    screening.candidates.map(async (item) => {
      if (item.source !== "mss-rss") return item;
      const body = await collectors.mssDetail(item.url, signal);
      return body ? withRepresentativeBody(item, body) : item;
    }),
  );

  // ── 6. 분석 (상위 모델 1회) + 검증. 남은 시간만 기다린다.
  const analysisTimeoutMs = Math.min(ANALYSIS_TIMEOUT_MS, remaining());
  if (analysisTimeoutMs < MIN_ANALYSIS_MS / 2) {
    throw new PipelineBudgetError("시간 예산이 부족해 최종 분석을 시작하지 못했습니다");
  }
  const analysis = await callAi(buildAnalysisRequest(candidates), { signal, timeoutMs: analysisTimeoutMs });
  addUsage(analysis.usage);

  // 최종 분석 0건 처리 (Design §5):
  //  - 응답 형식이 잘못됨(issues 목록 없음) → 실패
  //  - 올바른 응답의 issues 가 빈 목록 → AI가 본문을 읽고 모두 관련 없다고 판단한 것 → 정상 0건 (PRD 5장 "새 이슈 없음")
  //  - 답은 있는데 전부 검증에서 탈락 → 실패 (규칙에 어긋난 답을 0건으로 숨기지 않는다)
  const answered: unknown = (analysis.data as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(answered)) {
    throw new Error("분석 응답 형식이 맞지 않습니다 (issues 목록 없음)");
  }
  if (answered.length === 0) {
    return { status: "empty", issues: [], window, stats: { ...stats, aiCalls, analysisEmpty: true } };
  }
  const { issues, dropped, warnings } = analysisToIssues(candidates, analysis.data);
  if (issues.length === 0) {
    throw new Error(`분석 답변 ${answered.length}건이 모두 검증에서 탈락했습니다 (후보 ${screening.candidates.length}건, 버림 ${dropped}건)`);
  }

  const highRatio = issues.filter((issue) => issue.importance === "high").length / issues.length;
  return {
    status: "success",
    issues,
    window,
    stats: {
      ...stats,
      dropped,
      aiCalls,
      warnings,
      highRatio: { value: Math.round(highRatio * 100) / 100, needsReview: highRatio > HIGH_RATIO_CHECK },
    },
  };
}
