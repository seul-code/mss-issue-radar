// Design Ref: §2 처리 2·3 — AI에 보내는 지시문, 응답 양식(JSON Schema), 개발용 가짜 응답.
// 지시문에는 PRD 5장 "AI가 지킬 규칙" 중 이 단계에 해당하는 것만 넣는다.
import { CATEGORIES, CATEGORY_KEYWORDS } from "@/lib/categories";
import type { AiRequest } from "@/lib/ai/client";
import type { Category, Importance, RawItem } from "@/lib/types";

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
  const kind = item.source === "news-rss" ? "언론" : "정부";
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
      `- 관심 분야 10개(${CATEGORIES.join(", ")}) 중 하나라도 해당하고, 아래 '남길 것'에 맞는 자료만 남긴다.`,
      "",
      "[남길 것] 국내 중소기업·소상공인·전통시장·창업기업이 직접 영향을 받는 사안",
      "- 중기부 또는 산하기관(중진공·소진공·기보·신보·창진원·기정원·중소기업 관련 협회 등)이 나오는 자료",
      "- 다른 부처·지자체 정책이라도 중소기업·소상공인·창업기업을 대상으로 하거나 그들의 자금·세제·판로·인력·규제를 바꾸는 것",
      "- 중소기업·소상공인의 경영 여건을 다룬 통계·업계 동향 (예: 소상공인 매출, 중소기업 수출·생산, 창업 동향)",
      "",
      "[뺄 것] 중소기업·소상공인과의 연결이 제목·요약에 드러나지 않는 자료",
      "- 대기업·특정 상장사의 개별 경영·투자·실적 소식",
      "- 해외 정부·해외 시장 소식, 국제 협상·국제기구 동향 (국내 중소기업 영향이 직접 적혀 있지 않으면)",
      "- 주식·환율·부동산·거시경제 일반, 일반 소비자 대상 생활·소비 소식, 정치 공방",
      "- 과학기술·연구 일반 소식 (중소기업 지원·참여가 적혀 있지 않으면)",
      "- 애매하면 뺀다. 관련 자료가 적어도 괜찮다.",
      "",
      "- 같은 사건을 다룬 자료끼리 한 묶음(ids)으로 묶는다. 다른 사건은 다른 묶음이다.",
      "- 자료 하나는 한 묶음에만 넣는다. 입력에 없는 번호는 쓰지 않는다.",
      "- direct는 중기부·산하기관이 나오거나, 중소기업·소상공인 대상 정책·예산·법령이 바뀌는 사안이면 true, 업계 동향·간접 관련이면 false.",
      "- 제목과 요약에 있는 내용만 보고 판단한다.",
    ].join("\n"),
    input: items.map(candidateLine).join("\n"),
    // 개발용 가짜 응답: 모든 자료를 각각 관련 있음으로, 정부 자료는 direct로 본다.
    mock: () => ({
      groups: items.map((item, id) => ({ ids: [id], direct: item.source !== "news-rss" })),
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
    /** 세부 요약 3~5줄 (원문 사실만) */
    summary: string[];
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
          summary: { type: "array", items: { type: "string" } },
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
        importance: item.source === "news-rss" ? "medium" : "high",
        summary: [`[샘플 분석] ${item.title}`, "형식 확인용 가상 세부 내용 1", "형식 확인용 가상 세부 내용 2"],
        relevance: NO_EVIDENCE_TEXT,
        ideas: ["형식 확인용 가상 아이디어"],
        followUp: id % 2 === 0 ? "형식 확인용 가상 확인사항" : null,
      };
    }),
  };
}

/**
 * 분석용 자료 한 덩어리: 머리 줄(번호·출처·제목) + 본문(같은 사건 기사 합친 것, 최대 1,500자).
 * 세부 요약을 쓰려면 본문이 필요하다. 본문이 없으면 선별용 요약이라도 보낸다.
 */
function analysisBlock(item: RawItem, id: number): string {
  const kind = item.source === "news-rss" ? "언론" : "정부";
  const body = item.detail ?? item.excerpt ?? "(본문 없음 — 제목만 있음)";
  return `[${id}] ${kind} | ${item.publisher} | ${item.publishedAt} | ${item.title}\n본문: ${body}`;
}

/** 최종 후보(최대 20건)를 한 번에 보내 이슈 카드 내용을 받는 요청 (상위 모델 1회) */
export function buildAnalysisRequest(items: RawItem[]): AiRequest<AnalysisResponse> {
  return {
    tier: "main",
    schema: { name: "issue_analysis", schema: ANALYSIS_SCHEMA },
    instructions: [
      "너는 대한민국 중소벤처기업부 공무원의 업무를 돕는 정책 분석 도우미다.",
      "입력은 자료마다 두 줄이다: [번호] 정부/언론 | 발행처 | 발행 시각 | 제목 / 본문: …",
      "본문에는 같은 사건을 다룬 여러 언론사의 기사가 [발행처] 표시와 함께 이어 붙어 있을 수 있다.",
      "각 자료를 이슈 카드 내용으로 정리해 번호(id)와 함께 답한다.",
      "본문을 읽어 보니 국내 중소기업·소상공인·전통시장·창업기업과의 연결이 드러나지 않는 자료는 답하지 말고 뺀다.",
      "",
      "[분야 categories]",
      `- 다음 10개 중에서만 고른다: ${CATEGORIES.join(", ")}`,
      "- 1개 또는 2개. 더 관련 깊은 분야를 먼저 쓴다.",
      "",
      "[중요도 importance]",
      "- high: 중기부·산하기관을 직접 다루거나, 중소기업·소상공인을 대상으로 한 정책·예산·법령이 바뀌는 경우 (예: 중기부 발표, 중소기업 관련 법 개정, 소상공인 지원 예산 변경)",
      "- medium: 다른 부처의 정책 중 중소기업·소상공인에게 영향이 본문에 적힌 것, 또는 관심 분야의 업계 동향 (예: 소상공인 매출 통계, 중소기업 수출 동향)",
      "- low: 중소기업·소상공인과 간접적으로만 이어지는 경우 (예: 일반 경제 정책 중 일부만 관련)",
      "- 정부 발표라도 중소기업·소상공인 대상이 아니면 high로 하지 않는다 (예: 해외건설 펀드, 국제 탄소시장, 거시경제 대책 → medium 이하).",
      "",
      "[세부 요약 summary] 담당자가 원문을 열지 않아도 내용을 파악할 수 있게, 본문에 있는 사실을 3~5줄 항목으로 쓴다.",
      "- 한 줄에 사실 하나. 30~80자 정도의 짧은 문장. 줄 앞에 기호(•, -, 번호)는 붙이지 않는다.",
      "- 본문에 있으면 우선 담는다: 무엇을 하는지 · 지원 대상 · 금액·규모·비율 · 시행 시기·기간 · 신청 방법·기관 · 배경",
      "- 제목을 그대로 되풀이하지 않는다. 제목에 없는 세부 내용을 담는다.",
      "- 본문이 짧아 사실이 적으면 있는 만큼만 쓴다(최소 1줄). 해석이나 평가는 넣지 않는다.",
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
    input: items.map(analysisBlock).join("\n\n"),
    mock: () => mockAnalysis(items),
  };
}
