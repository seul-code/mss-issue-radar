// Design Ref: §4 — 저장소 입구. 다른 코드는 이 파일의 함수만 쓴다.
// 나중에 저장 방식을 바꿔도 이 폴더만 고치면 된다 (CLAUDE.md 3장).
// 모든 함수는 선택적으로 취소 신호(signal)를 받는다. Blob SDK의 abortSignal 로 넘겨 저장 단계의 대기 시간을 묶는다.
// (SDK는 쓰기를 기본 최대 10회 다시 시도하며, 재시도 사이 대기 중에는 취소가 다음 시도 때 반영된다 — 즉시 끝난다는 보장은 없다.)
import {
  BlobAlreadyExistsError,
  BlobVersionConflictError,
  createBlobJson,
  readBlobJson,
  writeBlobJsonIfVersion,
} from "@/lib/storage/blob";
import {
  createMemoryJson,
  MemoryAlreadyExistsError,
  MemoryVersionConflictError,
  readMemoryJson,
  writeMemoryJsonIfVersion,
} from "@/lib/storage/memory";
import { parseDailyRecord, parseHistoryIndex, parseRadarState, StateFormatError } from "@/lib/storage/parse";
import type { DailyRecord, HistoryIndex, RadarState } from "@/lib/types";

export { isDayString, StateFormatError } from "@/lib/storage/parse";

export type StorageKind = "blob" | "memory";

const STATE_PATH = "issue-radar/state.json";
const dailyPath = (date: string) => `issue-radar/history/${date}.json`;
const indexPath = (year: number) => `issue-radar/history/index-${year}.json`;

/** 설정이 잘못돼 저장소를 쓸 수 없는 경우 */
export class StorageConfigError extends Error {
  name = "StorageConfigError";
}

/**
 * 조건부 쓰기가 거절된 경우 (ifMatch 불일치·이미 있음 = HTTP 412).
 * 다른 실행이 먼저 저장했을 수도 있지만, 내 첫 저장이 성공했는데 응답만 끊겨 SDK가 다시 시도하다 412를 받은 것일 수도 있다.
 * 그래서 이 오류만으로 "충돌"이라고 단정하지 않는다 — saveStateChecked 처럼 다시 읽어 확인한다.
 */
export class StateConflictError extends Error {
  name = "StateConflictError";
}

/**
 * 운영 배포(VERCEL_ENV=production)에서만 Blob, 그 밖(로컬·preview)은 Blob 토큰이 있어도 개발용 메모리.
 * Design §4·§9: 시험 실행(가짜 AI 포함)이 운영 기록을 바꾸거나 운영 저장소의 무료 한도를 쓰지 않게 한다.
 * AI_MODE 가 아니라 실행 환경으로 정한다 — 로컬에서 실제 AI로 시험해도 운영 기록에는 닿지 않는다.
 * 운영에서는 메모리로 넘어가지 않는다 — 결과가 사라지는 것을 막는다.
 */
export function getStorageKind(): StorageKind {
  if (process.env.VERCEL_ENV !== "production") return "memory";
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new StorageConfigError("배포 환경인데 Blob 저장소가 연결되지 않았습니다 (BLOB_READ_WRITE_TOKEN 없음)");
  }
  return "blob";
}

/** 파일을 읽는다. JSON으로 읽을 수 없는 깨진 파일은 형식 오류로 바꾼다 — 화면은 안내를, 자동 실행은 덮어쓰지 않고 멈춘다. */
async function readJson(pathname: string, fresh: boolean, signal?: AbortSignal) {
  try {
    return getStorageKind() === "memory"
      ? await readMemoryJson(pathname, signal)
      : await readBlobJson(pathname, fresh, signal);
  } catch (error) {
    if (error instanceof SyntaxError) throw new StateFormatError(`${pathname} 파일을 JSON으로 읽을 수 없습니다`);
    throw error;
  }
}

async function writeJsonIfVersion(pathname: string, json: string, version: string | null, signal?: AbortSignal): Promise<string> {
  try {
    return getStorageKind() === "memory"
      ? await writeMemoryJsonIfVersion(pathname, json, version, signal)
      : await writeBlobJsonIfVersion(pathname, json, version, signal);
  } catch (error) {
    if (error instanceof BlobVersionConflictError || error instanceof MemoryVersionConflictError) {
      throw new StateConflictError(error.message);
    }
    throw error;
  }
}

// ─────────────────────────────── 최신 결과 (state.json) ───────────────────────────────

const EMPTY_STATE: RadarState = { lastSuccess: null, lastRun: null };

/** 저장된 상태와 버전. version이 null이면 아직 저장된 적이 없다. */
export interface VersionedState {
  state: RadarState;
  version: string | null;
}

/**
 * 저장된 상태를 버전과 함께 읽는다. 아직 저장된 적이 없으면 빈 상태.
 * 읽기에 실패하면 오류, 형식이 틀리면 StateFormatError 를 던진다.
 */
export async function getVersionedState(signal?: AbortSignal): Promise<VersionedState> {
  const raw = await readJson(STATE_PATH, true, signal);
  if (!raw) return { state: EMPTY_STATE, version: null };
  return { state: parseRadarState(raw.data), version: raw.version };
}

/** 화면용: 저장된 상태만 읽는다. */
export async function getState(): Promise<RadarState> {
  return (await getVersionedState()).state;
}

/**
 * 읽었던 버전 그대로일 때만 상태 전체를 저장하고 새 버전을 돌려준다 (서버 여러 대의 동시 실행 방지).
 * 거절되면 StateConflictError — 원인이 다른 실행인지 내 재시도인지는 saveStateChecked 가 가린다.
 */
export function saveStateIfVersion(state: RadarState, version: string | null, signal?: AbortSignal): Promise<string> {
  return writeJsonIfVersion(STATE_PATH, JSON.stringify(state), version, signal);
}

/** saveStateChecked 의 결과 */
export type CheckedSave =
  /** 저장됨 (응답이 끊겼지만 다시 읽어 보니 내 기록이 들어가 있던 경우 포함) */
  | { result: "saved"; version: string | null }
  /** 다른 실행이 먼저 바꿔 저장하지 않았다. 남의 기록은 덮어쓰지 않는다. */
  | { result: "conflict" }
  /** 저장하지 못했다. uncertain = 시간이 다 돼 다시 읽지 못해 실제로 들어갔는지 모른다. */
  | { result: "failed"; uncertain: boolean; error: unknown };

/**
 * 조건부로 저장하고, 오류가 나면 다시 읽어 실제 결과를 확인한다.
 * - 412·연결 오류가 나도 저장된 내용이 isMine(내 실행 식별값·내용)과 맞으면 "saved"
 * - 내 것이 아니고 버전이 바뀌었으면 "conflict" (다른 실행) — 다시 쓰지 않는다
 * - 버전이 그대로면 쓰기가 일어나지 않은 것이므로 "failed"
 */
export async function saveStateChecked(
  state: RadarState,
  version: string | null,
  isMine: (current: RadarState) => boolean,
  signal?: AbortSignal,
): Promise<CheckedSave> {
  try {
    return { result: "saved", version: await saveStateIfVersion(state, version, signal) };
  } catch (error) {
    if (signal?.aborted) return { result: "failed", uncertain: true, error };
    let current: VersionedState;
    try {
      current = await getVersionedState(signal);
    } catch {
      return { result: "failed", uncertain: true, error };
    }
    if (isMine(current.state)) return { result: "saved", version: current.version };
    if (error instanceof StateConflictError || current.version !== version) return { result: "conflict" };
    return { result: "failed", uncertain: false, error };
  }
}

// ─────────────────────────────── 날짜별 기록 ───────────────────────────────

/**
 * 한 날짜의 결과를 읽는다. 없으면 null.
 * 화면은 바뀌지 않는 파일이라 캐시를 써서 읽고, 자동 실행이 "이미 있음"을 확인할 때는 fresh 로 원본을 읽는다.
 */
export async function getDailyRecord(
  date: string,
  { fresh = false, signal }: { fresh?: boolean; signal?: AbortSignal } = {},
): Promise<DailyRecord | null> {
  const raw = await readJson(dailyPath(date), fresh, signal);
  return raw ? parseDailyRecord(raw.data) : null;
}

/**
 * 한 날짜의 결과를 새로 저장한다. 같은 날짜 파일이 이미 있으면 덮어쓰지 않고 "exists".
 * 과거 기록이 바뀌거나 지워지지 않게 하는 핵심 규칙이다.
 * "exists" 는 이전 기록일 수도, 내 첫 저장이 성공했는데 응답만 끊긴 것일 수도 있다 — 호출한 쪽이 내용을 비교해 가린다.
 */
export async function createDailyRecord(record: DailyRecord, signal?: AbortSignal): Promise<"created" | "exists"> {
  const json = JSON.stringify(record);
  try {
    if (getStorageKind() === "memory") await createMemoryJson(dailyPath(record.date), json, signal);
    else await createBlobJson(dailyPath(record.date), json, signal);
    return "created";
  } catch (error) {
    if (error instanceof BlobAlreadyExistsError || error instanceof MemoryAlreadyExistsError) return "exists";
    throw error;
  }
}

/** 한 해의 날짜 목록과 버전. 아직 없으면 빈 목록. */
export async function getHistoryIndex(
  year: number,
  signal?: AbortSignal,
): Promise<{ index: HistoryIndex; version: string | null }> {
  const raw = await readJson(indexPath(year), true, signal);
  if (!raw) return { index: { year, entries: [] }, version: null };
  return { index: parseHistoryIndex(raw.data, year), version: raw.version };
}

/** 읽었던 버전 그대로일 때만 날짜 목록을 저장한다. 거절되면 StateConflictError (원인 확인은 호출한 쪽이 다시 읽어서 한다). */
export function saveHistoryIndexIfVersion(index: HistoryIndex, version: string | null, signal?: AbortSignal): Promise<string> {
  return writeJsonIfVersion(indexPath(index.year), JSON.stringify(index), version, signal);
}
