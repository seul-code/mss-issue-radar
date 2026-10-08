// Design Ref: §1, §2 처리 6 — 대시보드. 저장소에 있는 마지막 결과를 읽기만 한다 (방문 시 AI 호출 없음).
// 화면은 미리 만들어 두고, 자동 실행이 저장을 마치면 revalidatePath("/")로 새로 만든다.
import IssueBoard from "@/components/IssueBoard";
import StatusBanner from "@/components/StatusBanner";
import SummaryBar from "@/components/SummaryBar";
import {
  emptyState,
  failedState,
  noneState,
  normalState,
} from "@/lib/ai/__fixtures__/sample-states";
import { getState } from "@/lib/storage";
import type { Importance, Issue, RadarState } from "@/lib/types";

/**
 * 자동 실행 후 갱신 신호를 놓쳐도 최대 1시간 안에는 새 결과를 읽도록 하는 안전장치.
 * 갱신은 방문이 있을 때만 일어나고 저장소 읽기 1회뿐이라 무료 한도에 영향이 거의 없다.
 */
export const revalidate = 3600;

const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** PRD 5장: 중요도 높음 → 보통 → 낮음, 같으면 최신순(대표 출처 날짜 기준). 원본 배열은 바꾸지 않는다. */
function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

// Design Ref: §7 — 개발 모드에서만 ?demo=normal|empty|failed|none 으로 샘플 상태를 바꿔 본다.
const DEMO_STATES: Record<string, RadarState> = {
  normal: normalState,
  empty: emptyState,
  failed: failedState,
  none: noneState,
};

export default async function Home({ searchParams }: PageProps<"/">) {
  // 배포(프로덕션)에서는 주소 뒤의 ?demo= 를 읽지 않는다. 그래서 화면을 미리 만들어 두는 방식이 유지된다.
  const demo = process.env.NODE_ENV === "development" ? (await searchParams).demo : undefined;
  // 저장소를 읽지 못하면 오류를 그대로 둔다. 화면을 다시 만드는 중에 실패하면 Next.js가 직전 화면을 계속 보여준다.
  const state = (typeof demo === "string" && DEMO_STATES[demo]) || (await getState());
  const issues = sortIssues(state.lastSuccess?.issues ?? []);

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold">중기부 이슈레이더</h1>
        <div className="mt-6 space-y-4">
          <StatusBanner state={state} />
          <SummaryBar result={state.lastSuccess} />
        </div>
        {/* 저장된 결과가 아예 없으면 상태 안내만 보여주고 필터·카드 영역은 숨긴다. */}
        {state.lastSuccess && (
          <div className="mt-6">
            <IssueBoard issues={issues} />
          </div>
        )}
      </main>

      {/* ⑥ 바닥글 — PRD 5장·7장의 고정 안내 문구 */}
      <footer className="border-t border-zinc-200 px-4 py-6 text-center text-xs leading-6 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p>AI가 생성한 분석으로, 사실 확인이 필요합니다.</p>
        <p>원문은 언론사 사정에 따라 열리지 않을 수 있습니다.</p>
      </footer>
    </>
  );
}
