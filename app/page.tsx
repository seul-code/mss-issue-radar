// Design Ref: §1 — 대시보드. 지금은 샘플 데이터를 쓰고, PLAN 23번에서 저장된 실제 결과로 바꾼다.
import SummaryBar from "@/components/SummaryBar";
import { normalState } from "@/lib/ai/__fixtures__/sample-states";

export default function Home() {
  const state = normalState;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold">중기부 이슈레이더</h1>
      <div className="mt-6">
        <SummaryBar result={state.lastSuccess} />
      </div>
    </main>
  );
}
