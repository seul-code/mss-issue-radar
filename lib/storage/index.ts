// Design Ref: §4 — 저장소 입구. 다른 코드는 이 파일의 함수만 쓴다.
// 나중에 저장 방식을 바꿔도 이 폴더만 고치면 된다 (CLAUDE.md 3장).
import { BlobVersionConflictError, readBlobState, writeBlobState } from "@/lib/storage/blob";
import { MemoryVersionConflictError, readMemoryState, writeMemoryState } from "@/lib/storage/memory";
import { parseRadarState } from "@/lib/storage/parse";
import type { RadarState } from "@/lib/types";

export { StateFormatError } from "@/lib/storage/parse";

export type StorageKind = "blob" | "memory";

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
  const raw = getStorageKind() === "memory" ? await readMemoryState() : await readBlobState();
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
export async function saveStateIfVersion(state: RadarState, version: string | null): Promise<string> {
  const json = JSON.stringify(state);
  try {
    return getStorageKind() === "memory" ? await writeMemoryState(json, version) : await writeBlobState(json, version);
  } catch (error) {
    if (error instanceof BlobVersionConflictError || error instanceof MemoryVersionConflictError) {
      throw new StateConflictError(error.message);
    }
    throw error;
  }
}
