// Design Ref: §4 — 저장소 입구. 다른 코드는 getState()/saveState() 만 쓴다.
// 나중에 저장 방식을 바꿔도 이 폴더만 고치면 된다 (CLAUDE.md 3장).
import { readBlobState, writeBlobState } from "@/lib/storage/blob";
import { readMemoryState, writeMemoryState } from "@/lib/storage/memory";
import type { RadarState } from "@/lib/types";

export type StorageKind = "blob" | "memory";

/** 설정이 잘못돼 저장소를 쓸 수 없는 경우 */
export class StorageConfigError extends Error {
  name = "StorageConfigError";
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

/** 저장된 상태를 읽는다. 아직 저장된 적이 없으면 빈 상태. 읽기에 실패하면 오류를 던진다. */
export async function getState(): Promise<RadarState> {
  if (getStorageKind() === "memory") return readMemoryState();
  return (await readBlobState()) ?? EMPTY_STATE;
}

/** 상태 전체를 저장한다. */
export async function saveState(state: RadarState): Promise<void> {
  if (getStorageKind() === "memory") return writeMemoryState(state);
  return writeBlobState(state);
}
