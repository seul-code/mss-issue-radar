// Design Ref: §1 — 대시보드. 지금은 샘플 데이터를 쓰고, PLAN 23번에서 저장된 실제 결과로 바꾼다.
import IssueCard from "@/components/IssueCard";
import SummaryBar from "@/components/SummaryBar";
import { normalState } from "@/lib/ai/__fixtures__/sample-states";

export default function Home() {
  const state = normalState;
  // 정렬(PLAN 10번)과 분야 필터(PLAN 11번)는 다음 작업에서 붙인다. 지금은 저장된 순서 그대로 보여준다.
  const issues = state.lastSuccess?.issues ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold">중기부 이슈레이더</h1>
      <div className="mt-6">
        <SummaryBar result={state.lastSuccess} />
      </div>
      <div className="mt-6 space-y-4">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
    </main>
  );
}
