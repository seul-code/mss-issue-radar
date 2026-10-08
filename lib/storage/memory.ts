// Design Ref: §4 — 개발용 저장소. Blob 토큰 없이 로컬에서 흐름을 시험할 때만 쓴다.
// 개발 서버를 다시 켜면 샘플 상태로 돌아간다. 배포에서는 쓰지 않는다 (lib/storage/index.ts 가 막음).
import { normalState } from "@/lib/ai/__fixtures__/sample-states";
import type { RadarState } from "@/lib/types";

// 자동 실행 주소와 화면이 서로 다른 묶음으로 빌드돼도 같은 값을 보도록 전역에 둔다.
const holder = globalThis as typeof globalThis & { __issueRadarState?: RadarState };

export async function readMemoryState(): Promise<RadarState> {
  holder.__issueRadarState ??= structuredClone(normalState);
  return structuredClone(holder.__issueRadarState);
}

export async function writeMemoryState(state: RadarState): Promise<void> {
  holder.__issueRadarState = structuredClone(state);
}
