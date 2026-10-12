// Design Ref: §1, §2 처리 6 — 대시보드. 저장소에 있는 마지막 결과를 읽기만 한다 (방문 시 AI 호출 없음).
// 화면은 미리 만들어 두고, 자동 실행이 저장을 마치면 revalidatePath("/")로 새로 만든다.
import HistoryPicker from "@/components/HistoryPicker";
import IssueBoard from "@/components/IssueBoard";
import PageHeader from "@/components/PageHeader";
import StatusBanner from "@/components/StatusBanner";
import SummaryBar from "@/components/SummaryBar";
import {
  emptyState,
  failedState,
  interruptedState,
  noneState,
  normalState,
  STALE_NOW,
  staleState,
} from "@/lib/ai/__fixtures__/sample-states";
import liveSample from "@/lib/ai/__fixtures__/live-sample.json";
import { kstDay } from "@/lib/format";
import { HISTORY_START_DATE, loadRecentHistory } from "@/lib/history";
import { sortIssues } from "@/lib/issues";
import { getState, StateFormatError } from "@/lib/storage";
import { parseRadarState } from "@/lib/storage/parse";
import type { RadarState } from "@/lib/types";

/**
 * 자동 실행 후 갱신 신호를 놓쳐도 최대 1시간 안에는 새 결과를 읽도록 하는 안전장치.
 * 갱신은 방문이 있을 때만 일어나고 저장소 읽기 1회뿐이라 무료 한도에 영향이 거의 없다.
 */
export const revalidate = 3600;

/** 데모 화면의 "지금" — 샘플 날짜가 고정돼 있어, 실행 직후 시각으로 맞춰야 지연 안내가 엉뚱하게 뜨지 않는다. */
function shortlyAfter(iso: string): number {
  return Date.parse(iso) + 2 * 3600_000;
}

// Design Ref: §7 — 개발 모드에서만 ?demo=normal|empty|failed|none|stale|interrupted|live 로 샘플 상태를 바꿔 본다.
// live = 2026-10-12 실제 AI 1회 실행 결과 (AI를 다시 부르지 않고 화면을 확인하기 위한 저장본)
const DEMO_STATES: Record<string, { state: RadarState; now: number }> = {
  normal: { state: normalState, now: shortlyAfter(normalState.lastRun!.at) },
  empty: { state: emptyState, now: shortlyAfter(emptyState.lastRun!.at) },
  failed: { state: failedState, now: shortlyAfter(failedState.lastRun!.at) },
  none: { state: noneState, now: Date.parse("2026-10-07T01:00:00Z") },
  stale: { state: staleState, now: Date.parse(STALE_NOW) },
  interrupted: { state: interruptedState, now: shortlyAfter(interruptedState.lastRun!.at) },
  live: { state: parseRadarState(liveSample), now: shortlyAfter(liveSample.lastRun.at) },
};

/** 화면을 만드는 시각. 지연 안내 판단에 쓴다 (화면은 최대 1시간마다 다시 만들어진다). */
function renderTime(): number {
  return Date.now();
}

/** 저장된 상태를 읽는다. 형식이 틀려 읽을 수 없으면 빈 상태와 함께 안내를 띄운다. */
async function loadState(): Promise<{ state: RadarState; unreadable: boolean }> {
  try {
    return { state: await getState(), unreadable: false };
  } catch (error) {
    // 형식 오류만 안내로 바꾼다. 연결 오류 등은 그대로 두어, 화면을 다시 만드는 중이면 Next.js가 직전 화면을 계속 보여준다.
    if (error instanceof StateFormatError) {
      console.error("[page] 저장된 상태 형식 오류", error.message);
      return { state: { lastSuccess: null, lastRun: null }, unreadable: true };
    }
    throw error;
  }
}

export default async function Home({ searchParams }: PageProps<"/">) {
  // 배포(프로덕션)에서는 주소 뒤의 ?demo= 를 읽지 않는다. 그래서 화면을 미리 만들어 두는 방식이 유지된다.
  const demo = process.env.NODE_ENV === "development" ? (await searchParams).demo : undefined;
  const demoEntry = typeof demo === "string" ? DEMO_STATES[demo] : undefined;
  const { state, unreadable } = demoEntry ? { state: demoEntry.state, unreadable: false } : await loadState();
  const now = demoEntry?.now ?? renderTime();
  const issues = sortIssues(state.lastSuccess?.issues ?? []);
  const today = kstDay(new Date(now));
  // 날짜 목록 파일 1개만 읽는다 (과거 날짜 내용은 고른 날짜 화면에서 그 파일만 읽음)
  const recent = await loadRecentHistory(today);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12">
      <PageHeader />
      <div className="mt-6 space-y-4">
        <StatusBanner state={state} now={now} unreadable={unreadable} />
        <SummaryBar result={state.lastSuccess} />
        <HistoryPicker recent={recent} today={today} min={HISTORY_START_DATE} />
      </div>
      {/* 저장된 결과가 아예 없으면 상태 안내만 보여주고 필터·카드 영역은 숨긴다. */}
      {state.lastSuccess && (
        <div className="mt-8">
          <IssueBoard issues={issues} />
        </div>
      )}
    </main>
  );
}
