// Design Ref: §2 처리 ⓒ·2 — 저가 모델에 보내는 지시문, 응답 양식(JSON Schema), 개발용 가짜 응답.
// 지시문에는 PRD 5장 "AI가 지킬 규칙" 중 이 단계에 해당하는 것만 넣는다.
import { CATEGORIES, CATEGORY_KEYWORDS } from "@/lib/categories";
import type { AiRequest } from "@/lib/ai/client";
import type { Category, Importance, RawItem } from "@/lib/types";

/** PRD 5장: 10개 분야를 묶은 웹 검색어 5개 (하루 최대 5회) */
export const SEARCH_QUERIES = [
  "중소벤처기업부",
  "소상공인 전통시장 지역경제",
  "창업 벤처 투자",
  "중소기업 수출 금융",
  "기술혁신 규제 디지털전환",
] as const;

/** 웹 검색 1회당 최대 기사 수 (5회 × 8건 = 하루 최대 40건) */
export const MAX_ARTICLES_PER_SEARCH = 8;

const kst = (date: Date) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(date);

// ─────────────────────────────── 웹 검색 ───────────────────────────────

export interface SearchResponse {
  articles: {
    title: string;
    url: string;
    publisher: string;
    /** 발행 시각 (시간대 포함 ISO 8601). 모르면 null → 코드가 버린다 (Design §2.1) */
    publishedAt: string | null;
    /** 기사 내용 1문장 (사실만) */
    summary: string;
  }[];
}

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          publishedAt: { type: ["string", "null"], description: "시간대를 포함한 ISO 8601. 모르면 null" },
          summary: { type: "string" },
        },
        required: ["title", "url", "publisher", "publishedAt", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["articles"],
  additionalProperties: false,
};

/** 검색어 하나로 최근 언론 기사를 찾는 요청 (저가 모델, 웹 검색 1회) */
export function buildSearchRequest(query: string, now: Date): AiRequest<SearchResponse> {
  return {
    tier: "light",
    webSearch: true,
    schema: { name: "news_search", schema: SEARCH_SCHEMA },
    instructions: [
      "너는 대한민국 중소벤처기업부 공무원을 위해 국내 언론 뉴스를 찾는 도우미다.",
      "웹 검색을 딱 한 번 하고, 그 검색 결과에 실제로 나온 기사만 답한다.",
      "규칙:",
      `- 기준 시각(${kst(now)}, 한국 시각)으로부터 최근 24시간 안에 발행된 국내 언론 기사만 고른다.`,
      `- 최대 ${MAX_ARTICLES_PER_SEARCH}건. 같은 기사를 두 번 쓰지 않는다.`,
      "- url은 검색 결과에 나온 원문 주소를 그대로 쓴다. 주소를 만들거나 고치지 않는다.",
      "- publishedAt은 기사에 적힌 발행 시각을 시간대 포함 ISO 8601로 쓴다. 알 수 없으면 null.",
      "- summary는 기사에 있는 사실만 1문장으로 쓴다. 기사에 없는 정책명·사업명·수치를 만들지 않는다.",
      "- 일반인의 이름·연락처는 쓰지 않는다. 기관명·기업명·공인의 공식 발언은 쓸 수 있다.",
      "- 정부 부처 보도자료 사이트(korea.kr, mss.go.kr)의 글은 제외한다. 따로 수집한다.",
      "- 맞는 기사가 없으면 빈 목록을 돌려준다.",
    ].join("\n"),
    input: `검색어: ${query}`,
    // 개발용 가짜 응답: 검색어마다 기사 2건 (주소는 example.com)
    mock: () => ({
      articles: [1, 2].map((n) => ({
        title: `[샘플] ${query} 관련 업계 동향 ${n}`,
        url: `https://example.com/news/${encodeURIComponent(query)}/${n}`,
        publisher: "샘플일보",
        publishedAt: new Date(now.getTime() - n * 3 * 3600_000).toISOString(),
        summary: `형식 확인용 가상 기사다 (${query}).`,
      })),
    }),
  };
}

// ─────────────────────────────── 1차 선별 ───────────────────────────────

export interface ScreeningResponse {
  /** 관련 있는 자료만, 같은 사건끼리 묶은 목록. 어디에도 없는 자료는 관련 없음으로 본다. */
  groups: {
    /** 후보 번호 목록 (같은 사건) */
    ids: number[];
    /** 중기부를 직접 다루거나 정책·예산·법령이 바뀌는 사안인지 (20건 자르기 우선순위) */
    direct: boolean;
  }[];
}

const SCREENING_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "integer" } },
          direct: { type: "boolean" },
        },
        required: ["ids", "direct"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

/** AI에 보낼 후보 한 줄: 번호 | 정부/언론 | 발행처 | 발행 시각 | 제목 | 요약. 필요한 필드만 보낸다 (CLAUDE.md 2장). */
function candidateLine(item: RawItem, id: number): string {
  const kind = item.source === "web-search" ? "언론" : "정부";
  return [id, kind, item.publisher, item.publishedAt, item.title, item.excerpt ?? ""].join(" | ");
}

/** 후보 전체를 한 번에 보내 관련 여부와 같은 사건 묶음을 판단하는 요청 (저가 모델 1회) */
export function buildScreeningRequest(items: RawItem[]): AiRequest<ScreeningResponse> {
  return {
    tier: "light",
    schema: { name: "screening", schema: SCREENING_SCHEMA },
    instructions: [
      "너는 대한민국 중소벤처기업부 공무원을 위해 뉴스·정책자료를 고르는 도우미다.",
      "입력은 한 줄에 자료 하나다: 번호 | 정부/언론 | 발행처 | 발행 시각 | 제목 | 요약",
      "규칙:",
      `- 관심 분야 10개(${CATEGORIES.join(", ")}) 중 하나라도 해당하는 자료만 남긴다. 하나도 해당하지 않으면 뺀다.`,
      "- 같은 사건을 다룬 자료끼리 한 묶음(ids)으로 묶는다. 다른 사건은 다른 묶음이다.",
      "- 자료 하나는 한 묶음에만 넣는다. 입력에 없는 번호는 쓰지 않는다.",
      "- direct는 중기부를 직접 언급했거나 정책·예산·법령이 바뀌는 사안이면 true, 업계 동향·간접 관련이면 false.",
      "- 제목과 요약에 있는 내용만 보고 판단한다.",
    ].join("\n"),
    input: items.map(candidateLine).join("\n"),
    // 개발용 가짜 응답: 모든 자료를 각각 관련 있음으로, 정부 자료는 direct로 본다.
    mock: () => ({
      groups: items.map((item, id) => ({ ids: [id], direct: item.source !== "web-search" })),
    }),
  };
}

// ─────────────────────────────── 최종 분석 ───────────────────────────────

/** 문구가 정해진 경우: 연결할 근거가 없을 때 연관성 칸에 쓰는 말 (PRD 5장) */
export const NO_EVIDENCE_TEXT = "직접 연관된 정책은 확인 필요";

export interface AnalysisResponse {
  /**
   * 후보 번호별 분석. 제목·날짜·출처·원문 주소는 AI에 맡기지 않고 코드가 후보에서 그대로 가져온다
   * (지어낸 링크·제목 방지). 관련 없다고 판단한 번호는 빠질 수 있다.
   */
  issues: {
    id: number;
    categories: Category[];
    importance: Importance;
    summary: string;
    relevance: string;
    ideas: string[];
    followUp: string | null;
  }[];
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
          importance: { type: "string", enum: ["high", "medium", "low"] },
          summary: { type: "string" },
          relevance: { type: "string" },
          ideas: { type: "array", items: { type: "string" } },
          followUp: { type: ["string", "null"] },
        },
        required: ["id", "categories", "importance", "summary", "relevance", "ideas", "followUp"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
};

/** 개발용 가짜 분석: 키워드로 분야를 고르고, 정부 자료는 중요도 높음으로 둔다. */
function mockAnalysis(items: RawItem[]): AnalysisResponse {
  return {
    issues: items.map((item, id) => {
      const text = `${item.title} ${item.excerpt ?? ""}`;
      const matched = CATEGORIES.filter((c) => CATEGORY_KEYWORDS[c].some((k) => text.includes(k)));
      return {
        id,
        categories: matched.length > 0 ? matched.slice(0, 2) : ["중소기업"],
        importance: item.source === "web-search" ? "medium" : "high",
        summary: `[샘플 분석] ${item.title}`,
        relevance: NO_EVIDENCE_TEXT,
        ideas: ["형식 확인용 가상 아이디어"],
        followUp: id % 2 === 0 ? "형식 확인용 가상 확인사항" : null,
      };
    }),
  };
}

/** 최종 후보(최대 20건)를 한 번에 보내 이슈 카드 내용을 받는 요청 (상위 모델 1회) */
export function buildAnalysisRequest(items: RawItem[]): AiRequest<AnalysisResponse> {
  return {
    tier: "main",
    schema: { name: "issue_analysis", schema: ANALYSIS_SCHEMA },
    instructions: [
      "너는 대한민국 중소벤처기업부 공무원의 업무를 돕는 정책 분석 도우미다.",
      "입력은 한 줄에 자료 하나다: 번호 | 정부/언론 | 발행처 | 발행 시각 | 제목 | 요약",
      "각 자료를 이슈 카드 내용으로 정리해 번호(id)와 함께 답한다. 중기부와 관련 없다고 판단한 자료는 빼도 된다.",
      "",
      "[분야 categories]",
      `- 다음 10개 중에서만 고른다: ${CATEGORIES.join(", ")}`,
      "- 1개 또는 2개. 더 관련 깊은 분야를 먼저 쓴다.",
      "",
      "[중요도 importance]",
      "- high: 중기부를 직접 언급했거나 정책·예산·법령이 바뀌는 경우 (예: 중기부 발표, 관련 법 개정, 예산 변경)",
      "- medium: 관심 분야의 업계 동향 (예: 시장 통계, 업계 발표, 타 부처 정책)",
      "- low: 간접적으로만 관련된 경우 (예: 일반 경제 뉴스 중 일부만 관련)",
      "",
      "[핵심내용 summary] 기사에 있는 사실만 2문장 이내로 쓴다. 해석이나 평가를 넣지 않는다.",
      "",
      "[중기부 연관성 relevance] 이 이슈가 중기부 업무와 어떻게 연결되는지 1~2문장으로 쓴다.",
      `- 연결할 근거가 자료에 없으면 정확히 "${NO_EVIDENCE_TEXT}"라고 쓴다.`,
      "",
      "[업무 활용 아이디어 ideas] 담당 공무원이 해볼 수 있는 일을 최대 2개, 각각 한 문장으로 쓴다.",
      "",
      "[추가 확인사항 followUp] 원문에서 더 확인해야 할 점이 있으면 1개만 쓴다. 없으면 null.",
      "",
      "[반드시 지킬 것]",
      "- 자료에 없는 정책명·사업명·수치는 절대 만들지 않는다.",
      "- 일반인의 이름·연락처는 쓰지 않는다. 기관명·기업명·공인의 공식 발언은 쓸 수 있다.",
      "- 입력에 없는 번호는 쓰지 않고, 한 번호에는 한 번만 답한다.",
      "- 모든 문장은 한국어로, 간결한 보고서 문체로 쓴다.",
    ].join("\n"),
    input: items.map(candidateLine).join("\n"),
    mock: () => mockAnalysis(items),
  };
}
