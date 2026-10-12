// Design Ref: §2 데이터 흐름 — 하루 1회 실행: 수집 → 전처리 → 1차 선별 → (48시간 확장) → 보도자료 본문 → 분석 → 검증.
// 저장과 하루 1회 중복 방지는 자동 실행 주소(app/api/cron)가 맡는다. 이 함수는 결과를 만들기만 한다.
// 실패하면 오류를 던진다. 호출한 쪽이 "실패"로 기록하고 직전 결과를 유지한다 (Design §5).
import { callAi, getAiMode, type AiMode } from "@/lib/ai/client";
import { buildAnalysisRequest, buildScreeningRequest } from "@/lib/ai/prompts";
import { analysisToIssues, pickCandidates } from "@/lib/ai/validate";
import { fetchMssDetail } from "@/lib/sources/mss-detail";
import { fetchMssRss } from "@/lib/sources/mss-rss";
import { fetchNewsRss } from "@/lib/sources/news-rss";
import { fetchPolicyNews } from "@/lib/sources/policy-news";
import { DETAIL_MAX, preprocess } from "@/lib/sources/preprocess";
import type { Issue, RawItem } from "@/lib/types";

/** PRD 5장: 24시간 안의 이슈가 5건 미만이면 48시간까지 넓힌다. */
const MIN_ISSUES_BEFORE_EXPANSION = 5;

/** 수집기 묶음. 시험할 때 가짜 수집기로 바꿔 끼울 수 있게 밖에서 받는다. */
export interface Collectors {
  mss: () => Promise<RawItem[]>;
  policyNews: (now: Date) => Promise<RawItem[]>;
  news: () => Promise<{ items: RawItem[]; errors: string[] }>;
  /** 중기부 보도자료 본문 읽기 (최종 후보만) */
  mssDetail: (url: string) => Promise<string | undefined>;
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
  /** 기록·비용 확인용 요약 (화면에는 표시하지 않음) */
  stats: {
    mode: AiMode;
    windowHours: 24 | 48;
    collected: { mss: number; policyNews: number; news: number };
    /** 실패한 출처와 이유 (키 값은 포함되지 않음) */
    sourceErrors: string[];
    candidates: number;
    dropped: number;
    aiCalls: number;
    usage: { inputTokens: number; outputTokens: number };
  };
}

/** 정부 자료 2곳이 모두 실패하면 던지는 오류 (Design §5: PRD "정부 자료 서버 장애") */
export class GovernmentSourcesError extends Error {
  name = "GovernmentSourcesError";
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
  collectors: Collectors = DEFAULT_COLLECTORS,
): Promise<PipelineResult> {
  // 설정이 잘못됐으면(배포인데 live 아님 등) 수집 전에 바로 멈춘다.
  const mode = getAiMode();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let aiCalls = 0;
  const addUsage = (u: { inputTokens: number; outputTokens: number }) => {
    aiCalls += 1;
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };

  // ── 1. 수집: 정부 자료 2곳 + 언론사 RSS를 동시에 (모두 무료, AI 호출 없음). 한 곳이 실패해도 계속 간다.
  const [mssResult, policyResult, newsResult] = await Promise.allSettled([
    collectors.mss(),
    collectors.policyNews(now),
    collectors.news(),
  ]);

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

  // ── 2. 전처리 + 1차 선별 (24시간)
  const screen = async (windowHours: 24 | 48) => {
    const items = preprocess(collected, { now, windowHours });
    if (items.length === 0) return { candidates: [], relevantCount: 0 };
    const response = await callAi(buildScreeningRequest(items));
    addUsage(response.usage);
    return pickCandidates(items, response.data);
  };

  let windowHours: 24 | 48 = 24;
  let screening = await screen(24);

  // ── 3. 관련 이슈가 5건 미만이면 48시간으로 넓혀 한 번 더 (저가 모델 +1회)
  if (screening.relevantCount < MIN_ISSUES_BEFORE_EXPANSION) {
    windowHours = 48;
    screening = await screen(48);
  }

  const stats = {
    mode,
    windowHours,
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
    return { status: "empty", issues: [], stats: { ...stats, aiCalls } };
  }

  // ── 5. 중기부 보도자료 본문 읽기: RSS에 본문이 없어 최종 후보로 뽑힌 것만 원문 페이지를 읽는다 (PRD 6장 예외).
  //       실패하면 기존 본문(같은 사건 언론 기사)이나 제목만으로 진행한다.
  const candidates = await Promise.all(
    screening.candidates.map(async (item) => {
      if (item.source !== "mss-rss") return item;
      const body = await collectors.mssDetail(item.url);
      if (!body) return item;
      return { ...item, detail: (item.detail ? `${body} / ${item.detail}` : body).slice(0, DETAIL_MAX) };
    }),
  );

  // ── 6. 분석 (상위 모델 1회) + 검증
  const analysis = await callAi(buildAnalysisRequest(candidates));
  addUsage(analysis.usage);
  const { issues, dropped } = analysisToIssues(candidates, analysis.data);

  // Design §5: AI 응답이 전부 규칙에 어긋나면 실패로 처리한다.
  if (issues.length === 0) {
    throw new Error(`분석 응답을 하나도 쓸 수 없습니다 (후보 ${screening.candidates.length}건, 버림 ${dropped}건)`);
  }

  return { status: "success", issues, stats: { ...stats, dropped, aiCalls } };
}
