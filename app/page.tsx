// Design Ref: §1 — 대시보드. 지금은 샘플 데이터를 쓰고, PLAN 23번에서 저장된 실제 결과로 바꾼다.
import IssueBoard from "@/components/IssueBoard";
import SummaryBar from "@/components/SummaryBar";
import { normalState } from "@/lib/ai/__fixtures__/sample-states";
import type { Importance, Issue } from "@/lib/types";

const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** PRD 5장: 중요도 높음 → 보통 → 낮음, 같으면 최신순(대표 출처 날짜 기준). 원본 배열은 바꾸지 않는다. */
function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

export default function Home() {
  const state = normalState;
  const issues = sortIssues(state.lastSuccess?.issues ?? []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold">중기부 이슈레이더</h1>
      <div className="mt-6">
        <SummaryBar result={state.lastSuccess} />
      </div>
      <div className="mt-6">
        <IssueBoard issues={issues} />
      </div>
    </main>
  );
}
