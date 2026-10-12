// 최신 화면과 과거 날짜 화면이 함께 쓰는 이슈 정렬 규칙.
import type { Importance, Issue } from "@/lib/types";

const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** PRD 5장: 중요도 높음 → 보통 → 낮음, 같으면 최신순(대표 출처 날짜 기준). 원본 배열은 바꾸지 않는다. */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}
