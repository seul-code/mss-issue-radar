// Design Ref: §1, §4-1 — 과거 날짜 화면 (/d/YYYY-MM-DD). PRD 6장 '지난 날짜 이슈 보기'.
// 고른 날짜의 파일 1개만 읽는다 (전체 기록을 읽지 않음). OpenAI는 부르지 않는다.
// 읽기 횟수 (Blob 무료 한도): 기록이 있으면 1회, 없으면 그 해 날짜 목록까지 2회. 범위 밖 날짜는 0회 (읽기 전에 404).
import Link from "next/link";
import { notFound } from "next/navigation";
import HistoryPicker from "@/components/HistoryPicker";
import IssueBoard from "@/components/IssueBoard";
import PageHeader from "@/components/PageHeader";
import SummaryBar from "@/components/SummaryBar";
import { formatKstDate, kstDay } from "@/lib/format";
import { HISTORY_START_DATE, isViewableDay } from "@/lib/history";
import { sortIssues } from "@/lib/issues";
import { getDailyRecord, getHistoryIndex, StateFormatError } from "@/lib/storage";
import type { DailyRecord, HistoryEntry } from "@/lib/types";

/**
 * 날짜마다 처음 방문할 때 한 번 만들어 계속 재사용한다 (같은 날짜를 여러 번 열어도 저장소를 다시 읽지 않음).
 * 다시 만드는 때는 자동 실행이 그 날짜의 기록을 바꿨을 때뿐이다: 오늘 날짜와 자동 복구한 날짜에 revalidatePath.
 * 기록이 없던 날짜(0건·실패·기록 없음 안내)도 같은 방식으로 캐시된다.
 */
export const revalidate = false;

/** 빈 목록: 빌드 때는 아무 날짜도 만들지 않고, 처음 방문할 때 만들어 저장해 둔다 (ISR). */
export async function generateStaticParams() {
  return [];
}

const NO_RECORD_MESSAGE: Record<HistoryEntry["status"] | "none", { icon: string; text: string }> = {
  success: { icon: "🗂️", text: "이 날의 기록 파일을 찾지 못했습니다. 다음 자동 실행 때 다시 채워질 수 있습니다." },
  empty: { icon: "☕", text: "이 날은 관련 이슈가 없었습니다 (0건). 그날 화면에는 직전 결과가 유지됐습니다." },
  failed: { icon: "⚠️", text: "이 날은 자동 처리가 실패해 새 기록이 없습니다. 그날 화면에는 직전 결과가 유지됐습니다." },
  none: { icon: "🌙", text: "이 날짜의 기록이 없습니다. 아직 자동 실행 전이거나 자동 실행이 없었던 날입니다." },
};

async function loadDaily(date: string): Promise<{ record: DailyRecord | null; unreadable: boolean }> {
  try {
    return { record: await getDailyRecord(date), unreadable: false };
  } catch (error) {
    // 깨진 파일·형식 오류는 안내만 보여준다. 파일은 고치거나 덮어쓰지 않고 원인 확인용으로 남긴다.
    if (error instanceof StateFormatError) {
      console.error("[day] 날짜별 기록 형식 오류", date, error.message);
      return { record: null, unreadable: true };
    }
    throw error;
  }
}

/** 기록 파일이 없을 때만 그 해 날짜 목록에서 그날 상태(0건·실패)를 찾는다. */
async function findEntry(date: string): Promise<HistoryEntry | undefined> {
  try {
    const { index } = await getHistoryIndex(Number(date.slice(0, 4)));
    return index.entries.find((e) => e.date === date);
  } catch {
    return undefined;
  }
}

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const today = kstDay(new Date());
  // 잘못된 날짜·미래 날짜·기록 시작일 이전 날짜는 저장소를 읽기 전에 막는다.
  if (!isViewableDay(date, today)) notFound();

  const { record, unreadable } = await loadDaily(date);
  const entry = record || unreadable ? undefined : await findEntry(date);
  const dateLabel = formatKstDate(`${date}T12:00:00+09:00`);
  const message = NO_RECORD_MESSAGE[entry?.status ?? "none"];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12">
      <PageHeader>
        <Link
          href="/"
          className="rounded-full bg-mint-100 px-3.5 py-1.5 text-sm font-semibold text-mint-700 transition-colors hover:bg-mint-300 hover:text-ink"
        >
          ← 최신 결과로
        </Link>
      </PageHeader>

      <div className="mt-6 space-y-4">
        <p className="rounded-3xl bg-lavender-100 px-5 py-3 font-display text-xl text-lavender-700 shadow-soft">
          📅 {date.slice(0, 4)}년 {dateLabel} 기록
        </p>
        {record ? (
          <SummaryBar
            result={{ issues: record.issues, generatedAt: record.generatedAt, window: record.window }}
            label="이 날의 이슈"
          />
        ) : (
          <p role="status" className="rounded-3xl bg-butter-100 px-5 py-3.5 text-sm font-semibold text-butter-700 ring-1 ring-butter-300">
            <span aria-hidden="true">{unreadable ? "⚠️" : message.icon} </span>
            {unreadable ? "이 날의 기록 파일을 읽을 수 없어 보여줄 수 없습니다. 저장된 파일은 그대로 두었습니다." : message.text}
          </p>
        )}
        {/* 이 화면은 오래 캐시되므로 '최근 기록' 칩은 대시보드(/)에만 둔다. 날짜 입력의 최대값은 브라우저에서 오늘로 맞춘다. */}
        <HistoryPicker today={today} min={HISTORY_START_DATE} current={date} />
      </div>

      {record && record.issues.length > 0 && (
        <div className="mt-8">
          <IssueBoard issues={sortIssues(record.issues)} emptyText="이 날은 고른 분야의 이슈가 없습니다" />
        </div>
      )}
    </main>
  );
}
