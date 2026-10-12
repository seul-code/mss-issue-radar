// Design Ref: §2 처리 5-1 — 날짜별 기록 보관 (PRD 6장: 지난 날짜 이슈 보기).
// 자동 실행이 끝날 때 최신 결과(state.json)를 저장하기 "전에" 부른다. 저장 순서: ① 날짜별 파일 → ② 날짜 목록 → ③ 최신 결과.
// - 성공한 날만 날짜별 파일을 만든다. 같은 날짜 파일이 이미 있으면 덮어쓰지 않는다. 자동 삭제는 하지 않는다.
// - 0건·실패한 날은 날짜별 파일 없이 날짜 목록에 상태만 남긴다.
// - 여기서 실패해도 최신 결과 저장(③)은 계속한다. 실패 이유는 돌려줘 실행 기록(historyError)에 남긴다.
// - 자동 복구: 직전 성공 결과의 날짜 파일이 날짜 목록에 없으면, 이번 실행 때 최신 결과로 그 날짜를 채운다.
// AI는 부르지 않는다. 쓰기 작업은 성공한 날 2회(날짜별 파일 + 날짜 목록), 0건·실패한 날 1회 (Blob 무료 한도 월 2,000회).
import { kstDay } from "@/lib/format";
import {
  createDailyRecord,
  getHistoryIndex,
  saveHistoryIndexIfVersion,
} from "@/lib/storage";
import type { HistoryEntry, HistoryIndex, RadarState, SuccessResult } from "@/lib/types";

const MAX_ERROR_LENGTH = 300;

/** 화면의 "최근 기록" 칩 개수 */
const RECENT_LIMIT = 10;

/**
 * 화면용: 그 해 날짜 목록에서 최근 기록을 최신순으로 돌려준다. 날짜 목록 파일 1개만 읽는다.
 * 읽기에 실패해도 화면은 그대로 보여야 하므로 빈 목록을 돌려준다 (날짜 직접 입력은 계속 가능).
 */
export async function loadRecentHistory(today: string): Promise<HistoryEntry[]> {
  try {
    const { index } = await getHistoryIndex(Number(today.slice(0, 4)));
    return index.entries.filter((e) => e.date <= today).reverse().slice(0, RECENT_LIMIT);
  } catch (error) {
    console.error("[history] 날짜 목록 읽기 실패", message(error));
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** 날짜 목록에 한 줄을 넣거나 고친다. 이미 성공으로 기록된 날짜는 실패·0건으로 바꾸지 않는다. */
export function upsertEntry(index: HistoryIndex, entry: HistoryEntry): HistoryIndex {
  const others = index.entries.filter((e) => e.date !== entry.date);
  const existing = index.entries.find((e) => e.date === entry.date);
  const keep = existing?.status === "success" && entry.status !== "success" ? existing : entry;
  return { ...index, entries: [...others, keep].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** 성공 결과 하나를 날짜별 파일로 남긴다. 이미 있으면 그대로 두고 "exists". */
function saveDaily(date: string, result: SuccessResult): Promise<"created" | "exists"> {
  return createDailyRecord({ date, generatedAt: result.generatedAt, window: result.window, issues: result.issues });
}

/**
 * 이번 실행 결과를 날짜별 기록에 반영한다. 문제가 없으면 undefined, 일부 실패하면 그 이유를 돌려준다.
 * @param previous 이번 실행 전의 상태 (자동 복구용)
 * @param next     이번 실행 후 저장할 상태 (lastRun.status 가 success·empty·failed 중 하나)
 */
export async function recordHistory(previous: RadarState, next: RadarState): Promise<string | undefined> {
  const run = next.lastRun;
  if (!run || run.status === "running") return undefined;

  const errors: string[] = [];
  const runDate = kstDay(new Date(run.at));
  /** 연도별로 날짜 목록에 넣을 줄. keepExisting = 그 날짜에 이미 성공 줄이 있으면 고치지 않음 */
  const pending = new Map<number, { entry: HistoryEntry; keepExisting: boolean }[]>();
  const queue = (entry: HistoryEntry, keepExisting = false) => {
    const year = Number(entry.date.slice(0, 4));
    pending.set(year, [...(pending.get(year) ?? []), { entry, keepExisting }]);
  };

  // ① 날짜별 파일 — 이번에 성공했으면 오늘 날짜로 저장
  if (run.status === "success" && next.lastSuccess) {
    try {
      const saved = await saveDaily(runDate, next.lastSuccess);
      // 파일이 이미 있었다면(같은 날 다시 실행) 파일은 그대로이므로 목록의 기존 줄도 그대로 둔다.
      queue({ date: runDate, status: "success", issueCount: next.lastSuccess.issues.length, at: run.at }, saved === "exists");
    } catch (error) {
      // 날짜 목록에는 넣지 않는다 → 다음 성공 실행이 자동 복구로 다시 시도한다.
      errors.push(`날짜별 파일 저장 실패(${runDate}): ${message(error)}`);
    }
  } else {
    queue({ date: runDate, status: run.status, issueCount: 0, at: run.at });
  }

  // 자동 복구 대상: 직전 성공 결과의 날짜 (오늘과 다를 때만)
  const prevSuccess = previous.lastSuccess;
  const prevDate = prevSuccess ? kstDay(new Date(prevSuccess.generatedAt)) : undefined;
  const healYear = prevDate && prevDate !== runDate ? Number(prevDate.slice(0, 4)) : undefined;
  if (healYear !== undefined && !pending.has(healYear)) pending.set(healYear, []);

  // ② 날짜 목록 — 연도별로 읽고 고쳐 쓴다 (읽기에 실패하면 쓰지 않는다)
  for (const [year, entries] of pending) {
    try {
      const { index, version } = await getHistoryIndex(year);
      let updated = index;

      if (year === healYear && prevSuccess && prevDate) {
        const recorded = index.entries.find((e) => e.date === prevDate && e.status === "success");
        if (!recorded) {
          await saveDaily(prevDate, prevSuccess);
          updated = upsertEntry(updated, {
            date: prevDate,
            status: "success",
            issueCount: prevSuccess.issues.length,
            at: prevSuccess.generatedAt,
          });
        }
      }
      for (const { entry, keepExisting } of entries) {
        const hasSuccess = updated.entries.some((e) => e.date === entry.date && e.status === "success");
        if (!(keepExisting && hasSuccess)) updated = upsertEntry(updated, entry);
      }

      if (updated !== index) await saveHistoryIndexIfVersion(updated, version);
    } catch (error) {
      errors.push(`날짜 목록 저장 실패(${year}): ${message(error)}`);
    }
  }

  return errors.length > 0 ? errors.join(" / ").slice(0, MAX_ERROR_LENGTH) : undefined;
}
