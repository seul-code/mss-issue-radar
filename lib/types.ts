// Design Ref: §2.1 — 수집·분석·저장·화면이 함께 쓰는 데이터 모양을 한곳에 모은다.
// 이 파일은 타입만 정의한다. 실제 값(분야 목록, 키워드 등)은 다른 파일에 둔다.

/** 관심 분야 10개 (PRD 4장). 이슈 하나에 최대 2개까지 붙는다. */
export type Category =
  | "중소기업"
  | "소상공인"
  | "전통시장"
  | "창업·벤처"
  | "수출"
  | "금융"
  | "기술혁신"
  | "규제"
  | "디지털전환"
  | "지역경제";

/** 중요도 3단계. 화면에는 높음 / 보통 / 낮음으로 표시한다. */
export type Importance = "high" | "medium" | "low";

/** 자료를 가져온 곳 */
export type SourceType =
  | "mss-rss" // 중기부 보도자료 RSS
  | "policy-news" // 정책브리핑 정책뉴스 API
  | "news-rss"; // 주요 언론사 RSS (lib/sources/news-rss.ts)

/** 수집 직후의 자료 한 건. AI 분석 전 단계에서만 쓴다. */
export interface RawItem {
  source: SourceType;
  title: string;
  /** 원문 주소. 없는 자료는 수집 단계에서 버린다. */
  url: string;
  /** 발행처 (예: 중소벤처기업부, ○○일보) */
  publisher: string;
  /** 발행 시각. UTC 기준 ISO 문자열로 저장한다 (Design §2.1 시간 기준). */
  publishedAt: string;
  /** 요약 또는 본문 앞부분 (최대 약 300자). 1차 선별에만 쓰고, 화면에 표시하거나 저장하지 않는다. */
  excerpt?: string;
  /**
   * 세부 요약용 본문 (최대 약 1,500자). 최종 후보의 분석에만 쓰고, 화면에 표시하거나 저장하지 않는다.
   * 같은 사건으로 묶인 다른 기사의 본문도 여기에 합쳐진다.
   */
  detail?: string;
}

/** 화면 카드 한 장 = 이슈 하나. 필드 순서는 PRD의 카드 9개 항목 순서를 따른다. */
export interface Issue {
  id: string;
  /** 1. 제목 */
  title: string;
  /** 2. 날짜 (UTC ISO, 화면에서 한국 시각으로 표시) */
  publishedAt: string;
  /** 2. 출처 이름 */
  sourceName: string;
  /** 3. 중요도 */
  importance: Importance;
  /** 4. 분야 1~2개, 관련 깊은 순 */
  categories: Category[];
  /** 5. 핵심내용 — 원문에 있는 사실만, 항목형 3~5줄 (무엇을·대상·규모·일정·방법 등) */
  summary: string[];
  /** 6. 중기부 연관성 (AI 분석) */
  relevance: string;
  /** 7. 업무 활용 아이디어 (AI 분석, 최대 2개) */
  ideas: string[];
  /** 8. 추가 확인사항 (최대 1개, 없으면 카드에서 숨김) */
  followUp?: string;
  /** 9. 원문 링크 — 수집 단계에서 실제로 받은 주소만 허용 */
  sourceUrl: string;
}

/** 자동 실행 한 번의 결과 상태 */
export type RunStatus = "success" | "empty" | "failed";

/** 마지막으로 성공한 분석 결과. 화면은 항상 이것을 보여준다. */
export interface SuccessResult {
  issues: Issue[];
  /** 결과가 만들어진 시각 (UTC ISO). 화면의 "마지막 업데이트" */
  generatedAt: string;
}

/** 가장 최근 자동 실행 기록. 실패·0건 안내와 하루 1회 중복 방지에 쓴다. */
export interface RunRecord {
  /** 실행 시각 (UTC ISO) */
  at: string;
  status: RunStatus;
  /** 이번 실행에서 만든 이슈 수 (기록용, 화면 숫자는 lastSuccess 기준) */
  issueCount: number;
  /** 실패 이유. 화면에는 표시하지 않는다. */
  error?: string;
}

/** Vercel Blob에 저장하는 파일 1개의 내용 (Design §2.1, §2 처리 5) */
export interface RadarState {
  lastSuccess: SuccessResult | null;
  lastRun: RunRecord | null;
}
