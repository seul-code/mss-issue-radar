// Design Ref: §4 — 저장소 입구. 다른 코드는 이 파일의 함수만 쓴다.
// 나중에 저장 방식을 바꿔도 이 폴더만 고치면 된다 (CLAUDE.md 3장).
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
import { parseDailyRecord, parseHistoryIndex, parseRadarState } from "@/lib/storage/parse";
import type { DailyRecord, HistoryIndex, RadarState } from "@/lib/types";

export { StateFormatError } from "@/lib/storage/parse";

export type StorageKind = "blob" | "memory";

const STATE_PATH = "issue-radar/state.json";
const dailyPath = (date: string) => `issue-radar/history/${date}.json`;
const indexPath = (year: number) => `issue-radar/history/index-${year}.json`;

/** 설정이 잘못돼 저장소를 쓸 수 없는 경우 */
export class StorageConfigError extends Error {
  name = "StorageConfigError";
}

/** 읽은 뒤 다른 실행이 먼저 저장해 조건부 쓰기가 거절된 경우 */
export class StateConflictError extends Error {
  name = "StateConflictError";
}

/**
 * Blob 토큰이 있으면 Blob, 없으면 개발용 메모리.
 * Design §4: 배포(VERCEL_ENV=production)에서는 메모리로 넘어가지 않는다 — 결과가 사라지는 것을 막는다.
 */
export function getStorageKind(): StorageKind {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.VERCEL_ENV === "production") {
    throw new StorageConfigError("배포 환경인데 Blob 저장소가 연결되지 않았습니다 (BLOB_READ_WRITE_TOKEN 없음)");
  }
  return "memory";
}

function readJson(pathname: string, fresh: boolean) {
  return getStorageKind() === "memory" ? readMemoryJson(pathname) : readBlobJson(pathname, fresh);
}

async function writeJsonIfVersion(pathname: string, json: string, version: string | null): Promise<string> {
  try {
    return getStorageKind() === "memory"
      ? await writeMemoryJsonIfVersion(pathname, json, version)
      : await writeBlobJsonIfVersion(pathname, json, version);
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
export async function getVersionedState(): Promise<VersionedState> {
  const raw = await readJson(STATE_PATH, true);
  if (!raw) return { state: EMPTY_STATE, version: null };
  return { state: parseRadarState(raw.data), version: raw.version };
}

/** 화면용: 저장된 상태만 읽는다. */
export async function getState(): Promise<RadarState> {
  return (await getVersionedState()).state;
}

/**
 * 읽었던 버전 그대로일 때만 상태 전체를 저장하고 새 버전을 돌려준다 (서버 여러 대의 동시 실행 방지).
 * 그 사이 다른 실행이 먼저 저장했으면 StateConflictError.
 */
export function saveStateIfVersion(state: RadarState, version: string | null): Promise<string> {
  return writeJsonIfVersion(STATE_PATH, JSON.stringify(state), version);
}

// ─────────────────────────────── 날짜별 기록 ───────────────────────────────

/** 한 날짜의 결과를 읽는다. 없으면 null. 바뀌지 않는 파일이라 캐시를 써서 읽는다. */
export async function getDailyRecord(date: string): Promise<DailyRecord | null> {
  const raw = await readJson(dailyPath(date), false);
  return raw ? parseDailyRecord(raw.data) : null;
}

/**
 * 한 날짜의 결과를 새로 저장한다. 같은 날짜 파일이 이미 있으면 덮어쓰지 않고 "exists".
 * 과거 기록이 바뀌거나 지워지지 않게 하는 핵심 규칙이다.
 */
export async function createDailyRecord(record: DailyRecord): Promise<"created" | "exists"> {
  const json = JSON.stringify(record);
  try {
    if (getStorageKind() === "memory") await createMemoryJson(dailyPath(record.date), json);
    else await createBlobJson(dailyPath(record.date), json);
    return "created";
  } catch (error) {
    if (error instanceof BlobAlreadyExistsError || error instanceof MemoryAlreadyExistsError) return "exists";
    throw error;
  }
}

/** 한 해의 날짜 목록과 버전. 아직 없으면 빈 목록. */
export async function getHistoryIndex(year: number): Promise<{ index: HistoryIndex; version: string | null }> {
  const raw = await readJson(indexPath(year), true);
  if (!raw) return { index: { year, entries: [] }, version: null };
  return { index: parseHistoryIndex(raw.data, year), version: raw.version };
}

/** 읽었던 버전 그대로일 때만 날짜 목록을 저장한다. 그 사이 바뀌었으면 StateConflictError. */
export function saveHistoryIndexIfVersion(index: HistoryIndex, version: string | null): Promise<string> {
  return writeJsonIfVersion(indexPath(index.year), JSON.stringify(index), version);
}
