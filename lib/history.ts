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
  getDailyRecord,
  getHistoryIndex,
  isDayString,
  saveHistoryIndexIfVersion,
} from "@/lib/storage";
import type { HistoryEntry, HistoryIndex, RadarState, SuccessResult } from "@/lib/types";

const MAX_ERROR_LENGTH = 300;

/**
 * 서비스 기록 시작일 (첫 실제 실행일). 이보다 이전 날짜는 저장소를 읽지 않고 404.
 * 날짜 화면의 주소 범위를 묶어, 아무 날짜나 열어 Blob 무료 읽기 한도를 쓰는 일을 막는다 (Design §4-1).
 */
export const HISTORY_START_DATE = "2026-10-12";

/** 날짜 화면에서 열 수 있는 날짜인지: 실제로 있는 날짜 + 기록 시작일 ~ 오늘(한국 날짜) */
export function isViewableDay(value: string, today: string): boolean {
  return isDayString(value) && value >= HISTORY_START_DATE && value <= today;
}

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

/**
 * 성공 결과 하나를 날짜별 파일로 남기고, 날짜 목록에 넣을 줄을 돌려준다. 이미 있는 파일은 절대 덮어쓰지 않는다.
 * "이미 있음"이면 원본을 다시 읽어 비교한다:
 *  - 이번 결과와 같으면 → 첫 저장은 성공했는데 응답이 끊겨 SDK 재시도가 거절된 경우. 이번 저장으로 본다.
 *  - 다르면 → 같은 날 이전 기록. 기존 파일 기준으로 줄을 만들어 목록과 파일 내용이 어긋나지 않게 한다 (existed).
 */
async function saveDaily(
  date: string,
  result: SuccessResult,
  signal?: AbortSignal,
): Promise<{ entry: HistoryEntry; existed: boolean }> {
  const record = { date, generatedAt: result.generatedAt, window: result.window, issues: result.issues };
  const mine: HistoryEntry = { date, status: "success", issueCount: result.issues.length, at: result.generatedAt };
  if ((await createDailyRecord(record, signal)) === "created") return { entry: mine, existed: false };

  const existing = await getDailyRecord(date, { fresh: true, signal });
  if (!existing) return { entry: mine, existed: true }; // 있다는데 읽히지 않음: 기존 줄이 있으면 그대로 둔다
  if (existing.generatedAt === record.generatedAt && existing.issues.length === record.issues.length) {
    return { entry: mine, existed: false };
  }
  return {
    entry: { date, status: "success", issueCount: existing.issues.length, at: existing.generatedAt },
    existed: true,
  };
}

export interface HistoryOutcome {
  /** 일부 저장에 실패했으면 그 이유 (실행 기록 historyError 로 남긴다) */
  error?: string;
  /** 날짜 화면 내용이 바뀌었을 수 있는 날짜 — 자동 실행이 그 화면들을 다시 만들게 한다 (오늘 + 복구한 날짜) */
  changedDates: string[];
}

/**
 * 이번 실행 결과를 날짜별 기록에 반영한다.
 * 한계 (Design §4-1): 자동 복구는 "직전 성공 결과" 한 건만 다시 시도한다. 복구까지 실패한 채 다음 성공이 오면
 * 그 날짜의 결과는 최신 결과에서도 밀려나 다시 채울 수 없다. 강제 종료로 running 만 남은 날은 목록에 실패로 남지 않는다.
 * @param previous 이번 실행 전의 상태 (자동 복구용)
 * @param next     이번 실행 후 저장할 상태 (lastRun.status 가 success·empty·failed 중 하나)
 * @param signal   저장 단계 시간 제한 (Blob SDK abortSignal)
 */
export async function recordHistory(previous: RadarState, next: RadarState, signal?: AbortSignal): Promise<HistoryOutcome> {
  const run = next.lastRun;
  if (!run || run.status === "running") return { changedDates: [] };

  const errors: string[] = [];
  const changedDates = new Set<string>();
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
      const { entry, existed } = await saveDaily(runDate, next.lastSuccess, signal);
      // 파일이 이미 있었다면(같은 날 다시 실행) 파일은 그대로이므로 목록의 기존 줄도 그대로 둔다.
      queue(entry, existed);
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
      const { index, version } = await getHistoryIndex(year, signal);
      let updated = index;

      if (year === healYear && prevSuccess && prevDate) {
        const recorded = index.entries.find((e) => e.date === prevDate && e.status === "success");
        if (!recorded) {
          // 복구 실패는 그 날짜에만 영향을 준다 — 오늘 줄은 아래에서 그대로 저장한다.
          // 다시 시도는 이 결과가 "직전 성공"으로 남아 있는 동안(다음 실행 1회)만 가능하다.
          try {
            const { entry } = await saveDaily(prevDate, prevSuccess, signal);
            updated = upsertEntry(updated, entry);
            changedDates.add(prevDate);
          } catch (error) {
            errors.push(`이전 날짜 복구 실패(${prevDate}): ${message(error)}`);
          }
        }
      }
      for (const { entry, keepExisting } of entries) {
        const hasSuccess = updated.entries.some((e) => e.date === entry.date && e.status === "success");
        if (!(keepExisting && hasSuccess)) updated = upsertEntry(updated, entry);
      }

      if (updated !== index) {
        try {
          await saveHistoryIndexIfVersion(updated, version, signal);
        } catch (error) {
          // 412·연결 오류여도 첫 저장이 성공하고 응답만 끊겼을 수 있다: 다시 읽어 쓰려던 목록과 같으면 저장된 것으로 본다.
          // 다르면 다른 실행이 바꾼 것이므로 덮어쓰지 않고 오류로 남긴다.
          if (signal?.aborted) throw error;
          const again = await getHistoryIndex(year, signal);
          if (JSON.stringify(again.index.entries) !== JSON.stringify(updated.entries)) throw error;
        }
      }
    } catch (error) {
      errors.push(`날짜 목록 저장 실패(${year}): ${message(error)}`);
    }
  }

  // 오늘 날짜 화면은 결과와 관계없이 다시 만든다 (성공·0건·실패 안내가 바뀜).
  changedDates.add(runDate);
  return {
    error: errors.length > 0 ? errors.join(" / ").slice(0, MAX_ERROR_LENGTH) : undefined,
    changedDates: [...changedDates],
  };
}
