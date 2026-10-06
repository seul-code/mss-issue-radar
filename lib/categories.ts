// Design Ref: §4 — 분야 10개의 화면 표시 순서. 요약 바와 분야 필터가 같은 순서를 쓴다.
import type { Category } from "@/lib/types";

/** PRD 5장 분야 필터 순서 ("전체" 다음에 오는 10개) */
export const CATEGORIES: readonly Category[] = [
  "소상공인",
  "전통시장",
  "중소기업",
  "창업·벤처",
  "수출",
  "금융",
  "기술혁신",
  "규제",
  "디지털전환",
  "지역경제",
];
