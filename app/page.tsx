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
import liveSample from "@/lib/ai/__fixtures__/live-sample.json";
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

// Design Ref: §7 — 개발 모드에서만 ?demo=normal|empty|failed|none|live 로 샘플 상태를 바꿔 본다.
// live = 2026-10-12 실제 AI 1회 실행 결과 (AI를 다시 부르지 않고 화면을 확인하기 위한 저장본)
const DEMO_STATES: Record<string, RadarState> = {
  normal: normalState,
  empty: emptyState,
  failed: failedState,
  none: noneState,
  live: liveSample as RadarState,
};

export default async function Home({ searchParams }: PageProps<"/">) {
  // 배포(프로덕션)에서는 주소 뒤의 ?demo= 를 읽지 않는다. 그래서 화면을 미리 만들어 두는 방식이 유지된다.
  const demo = process.env.NODE_ENV === "development" ? (await searchParams).demo : undefined;
  // 저장소를 읽지 못하면 오류를 그대로 둔다. 화면을 다시 만드는 중에 실패하면 Next.js가 직전 화면을 계속 보여준다.
  const state = (typeof demo === "string" && DEMO_STATES[demo]) || (await getState());
  const issues = sortIssues(state.lastSuccess?.issues ?? []);

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12">
        <header className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lavender-100 text-2xl shadow-soft"
          >
            🛰️
          </span>
          <div>
            <h1 className="font-display text-[28px] leading-tight text-ink sm:text-4xl">중기부 이슈레이더</h1>
            <p className="text-sm text-ink-soft">매일 아침, 중소기업·소상공인 정책 이슈를 한눈에</p>
          </div>
        </header>
        <div className="mt-6 space-y-4">
          <StatusBanner state={state} />
          <SummaryBar result={state.lastSuccess} />
        </div>
        {/* 저장된 결과가 아예 없으면 상태 안내만 보여주고 필터·카드 영역은 숨긴다. */}
        {state.lastSuccess && (
          <div className="mt-8">
            <IssueBoard issues={issues} />
          </div>
        )}
      </main>

      {/* ⑥ 바닥글 — PRD 5장·7장의 고정 안내 문구 */}
      <footer className="mt-10 border-t border-line px-4 py-6 text-center text-xs leading-6 text-ink-soft">
        <p>✨ AI가 생성한 분석으로, 사실 확인이 필요합니다.</p>
        <p>원문은 언론사 사정에 따라 열리지 않을 수 있습니다.</p>
      </footer>
    </>
  );
}
